#!/bin/sh
# Checks a commit header or PR title against the Conventional Commits rules the release
# skill reads the changelog from: `type(scope)!: subject` with a known type, an optional
# scope and `!`, a subject that does not start upper-case or end in a full stop, and at
# most 100 characters. Git's own Merge, Revert, Reapply, fixup!, squash! and amend!
# headers pass as they are.
#
#   scripts/check-commit-header.sh .git/COMMIT_EDITMSG    # a message file (the commit-msg hook)
#   printf '%s\n' "feat: x" | scripts/check-commit-header.sh
set -eu

types='feat fix docs style refactor perf test build ci chore revert'

[ $# -eq 0 ] || exec <"$1"

# The header is the first line that is neither blank nor a git comment; `git commit -v`
# puts its diff below the scissors line.
header=$(sed -e '/^# -* >8 -*$/,$d' -e '/^#/d' -e 's/[[:space:]]*$//' -e '/^$/d' | head -n 1)

fail() {
	printf 'commit header "%s": %s\n' "$header" "$1" >&2
	exit 1
}

[ -n "$header" ] || fail 'empty'

case $header in
'Merge '* | 'Revert "'* | 'Reapply "'* | 'fixup! '* | 'squash! '* | 'amend! '*) exit 0 ;;
esac

# Counts characters, not bytes: UTF-8 continuation bytes are dropped before counting.
length=$(printf '%s' "$header" | LC_ALL=C tr -d '\200-\277' | wc -c | tr -d ' ')
[ "$length" -le 100 ] || fail "$length characters, at most 100"

case $header in
*': '*) ;;
*) fail 'not "type(scope): subject"' ;;
esac
prefix=${header%%: *}
subject=${header#*: }
type=${prefix%%[(!]*}

case " $types " in
*" $type "*) ;;
*) fail "the type must be one of: $types" ;;
esac
case ${prefix#"$type"} in
'' | '!' | '('?*')' | '('?*')!') ;;
*) fail 'not "type(scope): subject"' ;;
esac
case $subject in
'') fail 'the subject is empty' ;;
[[:upper:]]*) fail 'the subject must not start upper-case' ;;
*.) fail 'the subject must not end with a full stop' ;;
esac
