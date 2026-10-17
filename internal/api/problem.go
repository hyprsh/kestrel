package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// problemError is returned by handlers to answer with an RFC 9457 problem. The
// strict server's error handler turns it into the response, so handlers stay
// in the "return a value or an error" shape and every failure carries a stable
// code.
type problemError struct {
	status     int
	code       string
	detail     string
	fields     []fieldError
	retryAfter time.Duration
}

type fieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type problemBody struct {
	Type   string       `json:"type"`
	Title  string       `json:"title"`
	Status int          `json:"status"`
	Detail string       `json:"detail"`
	Code   string       `json:"code"`
	Errors []fieldError `json:"errors,omitempty"`
}

func (e *problemError) Error() string { return e.code + ": " + e.detail }

func problem(status int, code, detail string) *problemError {
	return &problemError{status: status, code: code, detail: detail}
}

func invalid(field, code, message string) *problemError {
	p := problem(http.StatusUnprocessableEntity, "validation", message)
	p.fields = []fieldError{{Field: field, Code: code, Message: message}}
	return p
}

func (e *problemError) write(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/problem+json")
	if e.retryAfter > 0 {
		secs := int((e.retryAfter + time.Second - 1) / time.Second)
		w.Header().Set("Retry-After", strconv.Itoa(secs))
	}
	w.WriteHeader(e.status)
	body := problemBody{
		Type:   "about:blank",
		Title:  strings.ToLower(http.StatusText(e.status)),
		Status: e.status,
		Code:   e.code,
		Detail: e.detail,
		Errors: e.fields,
	}
	_ = json.NewEncoder(w).Encode(body)
}

func writeProblem(w http.ResponseWriter, status int, code, detail string) {
	problem(status, code, detail).write(w)
}

func asProblem(err error) (*problemError, bool) {
	var p *problemError
	return p, errors.As(err, &p)
}
