#!/usr/bin/env bash
# publish.sh <PR number> <dir>: commits the images in <dir> (png, jpg, gif, webp)
# to the orphan branch pr-assets/<PR> on origin, keeping images already there
# unless one of the same name replaces it, and prints each image's URL. The URLs
# name the commit, so a PR body that embeds them keeps working after a re-publish.
# Touches no checkout, index or other branch: the commit is built with git plumbing.
set -euo pipefail

pr=${1:?usage: publish.sh <PR number> <dir>}
src=${2:?usage: publish.sh <PR number> <dir>}
case $pr in *[!0-9]*) echo "publish: $pr is not a PR number" >&2; exit 2 ;; esac
branch=pr-assets/$pr

shopt -s nullglob nocaseglob
images=("$src"/*.png "$src"/*.jpg "$src"/*.jpeg "$src"/*.gif "$src"/*.webp)
[ ${#images[@]} -gt 0 ] || { echo "publish: no images in $src" >&2; exit 1; }

parent=
if git fetch -q origin "refs/heads/$branch" 2>/dev/null; then
  parent=$(git rev-parse FETCH_HEAD)
fi

entries=$(
  [ -z "$parent" ] || git ls-tree "$parent"
  for f in "${images[@]}"; do
    printf '100644 blob %s\t%s\n' "$(git hash-object -w "$f")" "$(basename "$f")"
  done
)
# The last entry of a name wins, so a new image replaces an old one of the same name.
tree=$(printf '%s\n' "$entries" | awk -F'\t' '{ line[$2] = $0 } END { for (n in line) print line[n] }' | git mktree)
commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "chore: screenshots for #$pr")
git push -q origin "$commit:refs/heads/$branch"

slug=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "published ${#images[@]} images to $branch at $commit"
for f in "${images[@]}"; do
  echo "https://raw.githubusercontent.com/$slug/$commit/$(basename "$f")"
done
