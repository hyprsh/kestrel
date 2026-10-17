// Package fake is the in-memory download_client.v1 client. Host tests (acquire,
// jobs, the API) use it in place of SABnzbd; it passes the same conformance
// suite as the real adapters, so what a test sees is what the contract promises.
package fake

import (
	"context"
	"fmt"
	"sync"

	"github.com/hyprsh/kestrel/internal/plugin"
	downloadclient "github.com/hyprsh/kestrel/internal/plugin/downloadclient/v1"
)

// ID is the fake's plugin id.
const ID = "fake"

// Client is an in-memory download client. The zero value is not usable; use New.
type Client struct {
	apiKey string

	mu    sync.Mutex
	seq   int
	items []downloadclient.Item
}

var _ downloadclient.Client = (*Client)(nil)

// New returns a client that accepts connections whose "api_key" is apiKey.
func New(apiKey string) *Client { return &Client{apiKey: apiKey} }

// Conn returns a working connection to c. Set Config["unreachable"] to true on a copy to
// simulate a client that is down.
func (c *Client) Conn(id int64) plugin.Connection {
	return plugin.Connection{ID: id, Config: map[string]any{"api_key": c.apiKey}}
}

func (*Client) Describe() plugin.Manifest {
	return plugin.Manifest{
		ID: ID, Name: "In-memory fake", Contract: downloadclient.Contract.ID, Version: "1",
		Capabilities: map[string][]string{"protocols": {"usenet"}},
		Fields: []plugin.Field{
			{Key: "api_key", Label: "API key", Type: plugin.FieldSecret, Required: true},
			{Key: "movie_category", Label: "Movie category", Type: plugin.FieldText, Default: "movies", Live: true},
		},
	}
}

func (c *Client) check(conn plugin.Connection) error {
	if conn.Bool("unreachable") {
		return plugin.Errorf(plugin.CodeUnavailable, "the fake is down")
	}
	if conn.String("api_key") != c.apiKey {
		return plugin.Errorf(plugin.CodeAuth, "API key rejected")
	}
	return nil
}

func (c *Client) Test(_ context.Context, conn plugin.Connection) (plugin.TestResult, error) {
	if err := c.check(conn); err != nil {
		return plugin.TestResult{}, err
	}
	return plugin.TestResult{Message: "fake client"}, nil
}

func (c *Client) ListOptions(_ context.Context, conn plugin.Connection, field string) ([]plugin.Option, error) {
	if err := c.check(conn); err != nil {
		return nil, err
	}
	if field != "movie_category" {
		return nil, plugin.Errorf(plugin.CodeInvalid, "no live options for %q", field)
	}
	return []plugin.Option{{Value: "movies", Label: "movies"}, {Value: "tv", Label: "tv"}}, nil
}

func (c *Client) Add(_ context.Context, conn plugin.Connection, req downloadclient.AddRequest) (string, error) {
	if err := c.check(conn); err != nil {
		return "", err
	}
	if len(req.Data) == 0 {
		return "", plugin.Errorf(plugin.CodeInvalid, "empty payload")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.seq++
	id := fmt.Sprintf("fake_%d", c.seq)
	c.items = append(c.items, downloadclient.Item{
		ClientID: id, Name: req.Filename, Category: req.Category, Phase: downloadclient.PhaseQueued,
		BytesTotal: 1000, BytesLeft: 1000,
	})
	return id, nil
}

func (c *Client) List(_ context.Context, conn plugin.Connection, category string) ([]downloadclient.Item, error) {
	if err := c.check(conn); err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	out := []downloadclient.Item{}
	for _, it := range c.items {
		if category == "" || it.Category == category {
			out = append(out, it)
		}
	}
	return out, nil
}

func (c *Client) Remove(_ context.Context, conn plugin.Connection, clientID string, _ bool) error {
	if err := c.check(conn); err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for i, it := range c.items {
		if it.ClientID == clientID {
			c.items = append(c.items[:i], c.items[i+1:]...)
			break
		}
	}
	return nil
}

// Complete finishes a job with its files at outputPath (conformance.Backend).
func (c *Client) Complete(clientID, outputPath string) error {
	return c.update(clientID, func(it *downloadclient.Item) {
		it.Phase, it.OutputPath, it.CanRemove, it.BytesLeft = downloadclient.PhaseCompleted, outputPath, true, 0
	})
}

// Fail ends a job with a failure (conformance.Backend).
func (c *Client) Fail(clientID string, failure downloadclient.Failure, message string) error {
	return c.update(clientID, func(it *downloadclient.Item) {
		it.Phase, it.Failure, it.Message = downloadclient.PhaseFailed, failure, message
	})
}

// SetPhase moves a job to phase, for host tests that need a job mid-flight.
func (c *Client) SetPhase(clientID string, phase downloadclient.Phase, bytesLeft int64) error {
	return c.update(clientID, func(it *downloadclient.Item) { it.Phase, it.BytesLeft = phase, bytesLeft })
}

func (c *Client) update(clientID string, f func(*downloadclient.Item)) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	for i := range c.items {
		if c.items[i].ClientID == clientID {
			f(&c.items[i])
			return nil
		}
	}
	return fmt.Errorf("fake: no job %q", clientID)
}
