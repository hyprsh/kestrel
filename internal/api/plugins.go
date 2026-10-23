package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/hyprsh/kestrel/internal/api/oapi"
	"github.com/hyprsh/kestrel/internal/plugin"
	"github.com/hyprsh/kestrel/internal/plugin/instances"
)

// pluginCallTimeout bounds one live call into a plugin (test, dropdown values).
const pluginCallTimeout = 30 * time.Second

func (s *server) ListPlugins(_ context.Context, _ oapi.ListPluginsRequestObject) (oapi.ListPluginsResponseObject, error) {
	ms := s.plugins.Registry().Manifests()
	out := oapi.PluginList{Items: make([]oapi.PluginManifest, len(ms))}
	for i, m := range ms {
		out.Items[i] = manifestToAPI(m)
	}
	return oapi.ListPlugins200JSONResponse(out), nil
}

func (s *server) ListPluginInstances(ctx context.Context, _ oapi.ListPluginInstancesRequestObject) (oapi.ListPluginInstancesResponseObject, error) {
	all, err := s.plugins.List(ctx)
	if err != nil {
		return nil, err
	}
	out := oapi.PluginInstanceList{Items: make([]oapi.PluginInstance, len(all))}
	for i, inst := range all {
		out.Items[i] = s.instanceToAPI(inst)
	}
	return oapi.ListPluginInstances200JSONResponse(out), nil
}

func (s *server) GetPluginInstance(ctx context.Context, r oapi.GetPluginInstanceRequestObject) (oapi.GetPluginInstanceResponseObject, error) {
	inst, err := s.plugins.Get(ctx, r.Id)
	if err != nil {
		return nil, pluginProblem(err)
	}
	return oapi.GetPluginInstance200JSONResponse(s.instanceToAPI(inst)), nil
}

func (s *server) CreatePluginInstance(ctx context.Context, r oapi.CreatePluginInstanceRequestObject) (oapi.CreatePluginInstanceResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	b := r.Body
	if err := s.refuseDeclaredName(b.Name); err != nil {
		return nil, err
	}
	in := instances.New{PluginID: b.PluginId, Name: b.Name, Enabled: b.Enabled, Config: b.Config}
	if b.Priority != nil {
		in.Priority = *b.Priority
	}
	inst, err := s.plugins.Create(ctx, in)
	if err != nil {
		return nil, pluginProblem(err)
	}
	return oapi.CreatePluginInstance201JSONResponse(s.instanceToAPI(inst)), nil
}

func (s *server) UpdatePluginInstance(ctx context.Context, r oapi.UpdatePluginInstanceRequestObject) (oapi.UpdatePluginInstanceResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	if err := s.refuseDeclaredInstance(ctx, r.Id); err != nil {
		return nil, err
	}
	b := r.Body
	if b.Name != nil {
		if err := s.refuseDeclaredName(*b.Name); err != nil {
			return nil, err
		}
	}
	patch := instances.Patch{Name: b.Name, Enabled: b.Enabled, Priority: b.Priority}
	if b.Config != nil {
		patch.Config = *b.Config
	}
	inst, err := s.plugins.Update(ctx, r.Id, patch)
	if err != nil {
		return nil, pluginProblem(err)
	}
	return oapi.UpdatePluginInstance200JSONResponse(s.instanceToAPI(inst)), nil
}

func (s *server) DeletePluginInstance(ctx context.Context, r oapi.DeletePluginInstanceRequestObject) (oapi.DeletePluginInstanceResponseObject, error) {
	if err := s.refuseDeclaredInstance(ctx, r.Id); err != nil {
		return nil, err
	}
	if err := s.plugins.Delete(ctx, r.Id); err != nil {
		return nil, pluginProblem(err)
	}
	return oapi.DeletePluginInstance204Response{}, nil
}

func (s *server) TestPluginConfig(ctx context.Context, r oapi.TestPluginConfigRequestObject) (oapi.TestPluginConfigResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	res, err := s.runTest(ctx, r.Body.PluginId, 0, r.Body.Config)
	if err != nil {
		return nil, err
	}
	return oapi.TestPluginConfig200JSONResponse(res), nil
}

func (s *server) TestPluginInstance(ctx context.Context, r oapi.TestPluginInstanceRequestObject) (oapi.TestPluginInstanceResponseObject, error) {
	inst, err := s.plugins.Get(ctx, r.Id)
	if err != nil {
		return nil, pluginProblem(err)
	}
	var edits map[string]any
	if r.Body != nil && r.Body.Config != nil {
		edits = *r.Body.Config
	}
	res, err := s.runTest(ctx, inst.PluginID, inst.ID, edits)
	if err != nil {
		return nil, err
	}
	return oapi.TestPluginInstance200JSONResponse(res), nil
}

// runTest runs a plugin's live test. A failing test is a result, not an HTTP error.
func (s *server) runTest(ctx context.Context, pluginID string, instanceID int64, edits map[string]any) (oapi.PluginTestResult, error) {
	p, conn, err := s.plugins.Resolve(ctx, pluginID, instanceID, edits, true)
	if err != nil {
		return oapi.PluginTestResult{}, pluginProblem(err)
	}
	ctx, cancel := context.WithTimeout(ctx, pluginCallTimeout)
	defer cancel()
	res, err := p.Test(ctx, conn)
	if err != nil && ctx.Err() != nil && errors.Is(err, ctx.Err()) {
		err = plugin.Errorf(plugin.CodeUnavailable, "the plugin did not answer in time")
	}
	if instanceID != 0 && len(edits) == 0 {
		// A test of the saved connection is a check of it; one of edits is of the form.
		if rerr := s.plugins.RecordCheck(context.WithoutCancel(ctx), instanceID, s.opts.Clock(), err); rerr != nil {
			s.opts.Logger.Warn("recording a plugin instance check failed", "instance", instanceID, "err", rerr)
		}
	}
	if err == nil {
		return oapi.PluginTestResult{Ok: true, Message: res.Message}, nil
	}
	pe := plugin.AsError(err)
	code := string(pe.Code)
	return oapi.PluginTestResult{Ok: false, Code: &code, Message: pe.Message}, nil
}

func (s *server) ListPluginOptions(ctx context.Context, r oapi.ListPluginOptionsRequestObject) (oapi.ListPluginOptionsResponseObject, error) {
	if r.Body == nil {
		return nil, invalid("body", "required", "a body is required")
	}
	var instanceID int64
	if r.Body.InstanceId != nil {
		instanceID = *r.Body.InstanceId
	}
	p, conn, err := s.plugins.Resolve(ctx, r.PluginId, instanceID, r.Body.Config, false)
	if err != nil {
		if errors.Is(err, instances.ErrNotFound) {
			return nil, invalid("instance_id", "invalid", "no such instance")
		}
		return nil, pluginProblem(err)
	}
	ctx, cancel := context.WithTimeout(ctx, pluginCallTimeout)
	defer cancel()
	opts, err := p.ListOptions(ctx, conn, r.Field)
	if err != nil {
		pe := plugin.AsError(err)
		if pe.Code == plugin.CodeInvalid {
			return nil, invalid("field", "invalid", pe.Message)
		}
		out := problem(http.StatusBadGateway, "upstream_unavailable", pe.Message)
		out.retryAfter = pe.RetryAfter
		return nil, out
	}
	out := oapi.PluginOptionList{Items: make([]oapi.PluginOption, len(opts))}
	for i, o := range opts {
		out.Items[i] = oapi.PluginOption{Value: o.Value, Label: o.Label}
	}
	return oapi.ListPluginOptions200JSONResponse(out), nil
}

// pluginProblem maps the instances service's errors onto problems.
func pluginProblem(err error) error {
	var ve *instances.ValidationError
	switch {
	case errors.Is(err, instances.ErrNotFound):
		return problem(http.StatusNotFound, "not_found", "no such plugin instance")
	case errors.As(err, &ve):
		p := problem(http.StatusUnprocessableEntity, "validation", ve.Problems[0].Message)
		for _, fp := range ve.Problems {
			p.fields = append(p.fields, fieldError{Field: fp.Field, Code: fp.Code, Message: fp.Message})
		}
		return p
	}
	return err
}

func (s *server) instanceToAPI(i instances.Instance) oapi.PluginInstance {
	cfg, set := s.plugins.Public(i)
	return oapi.PluginInstance{
		LastCheck: checkToAPI(i.LastCheck),
		Id:        i.ID, Contract: i.Contract, PluginId: i.PluginID, Name: i.Name,
		Enabled: i.Enabled, Priority: i.Priority, Config: cfg, SecretsSet: set, FromConfigFile: s.instanceDeclared(i),
	}
}

// refuseDeclaredInstance answers 409 when the Config File declares the
// instance, and 404 when there is none.
func (s *server) refuseDeclaredInstance(ctx context.Context, id int64) error {
	inst, err := s.plugins.Get(ctx, id)
	if err != nil {
		return pluginProblem(err)
	}
	if s.instanceDeclared(inst) {
		return s.declaredConflict(fmt.Sprintf("the plugin instance %q", inst.Name), changeTheFile)
	}
	return nil
}

func manifestToAPI(m plugin.Manifest) oapi.PluginManifest {
	out := oapi.PluginManifest{
		Id: m.ID, Name: m.Name, Contract: m.Contract, Version: m.Version,
		Capabilities: map[string][]string{}, Fields: make([]oapi.PluginField, len(m.Fields)),
	}
	for k, v := range m.Capabilities {
		out.Capabilities[k] = append([]string{}, v...)
	}
	for i, f := range m.Fields {
		opts := make([]oapi.PluginOption, len(f.Options))
		for j, o := range f.Options {
			opts[j] = oapi.PluginOption{Value: o.Value, Label: o.Label}
		}
		out.Fields[i] = oapi.PluginField{
			Key: f.Key, Label: f.Label, Type: oapi.PluginFieldType(f.Type), Required: f.Required,
			Default: f.Default, Help: f.Help, Options: opts, Live: f.Live,
		}
	}
	return out
}

func checkToAPI(c *instances.Check) *oapi.PluginInstanceCheck {
	if c == nil {
		return nil
	}
	out := oapi.PluginInstanceCheck{At: c.At, Ok: c.OK}
	if !c.OK {
		out.Code, out.Message = &c.Code, &c.Message
	}
	return &out
}
