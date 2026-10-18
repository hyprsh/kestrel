package metadata

import "errors"

// Standing is what one provider call says about the provider's health.
type Standing struct {
	// Counts is false for a call that says nothing about the provider: a rate
	// limit, or an error that is not the provider's (a canceled request).
	Counts bool
	// Failing is true when the call failed in a way that counts against the provider.
	Failing bool
	// Auth is true when the provider refused the key.
	Auth    bool
	Message string
}

// StandingOf reads a provider call's error. A good call and a not-found are
// healthy; a rate limit and foreign errors are ignored; a refused key and any
// other provider error count against the provider.
func StandingOf(err error) Standing {
	if err == nil {
		return Standing{Counts: true}
	}
	var me *Error
	if !errors.As(err, &me) {
		return Standing{}
	}
	switch me.Code {
	case CodeNotFound:
		return Standing{Counts: true}
	case CodeRateLimited:
		return Standing{}
	case CodeAuth:
		return Standing{Counts: true, Failing: true, Auth: true, Message: me.Message}
	}
	return Standing{Counts: true, Failing: true, Message: me.Message}
}
