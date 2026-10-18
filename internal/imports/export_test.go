package imports

import "context"

// NoteCrossDevice lets tests drive the copy-across-filesystems notice, which a
// real filesystem boundary would otherwise be needed for.
func (s *Service) NoteCrossDevice(ctx context.Context, root string, cross bool) {
	s.noteCrossDevice(ctx, root, cross)
}
