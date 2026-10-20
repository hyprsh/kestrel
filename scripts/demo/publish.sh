#!/usr/bin/env bash
# publish.sh <PR number> <dir>: commits the images in <dir> (png, jpg, gif, webp)
# to the folder <PR>/ of the orphan branch pr-assets on origin, which holds every
# PR's screenshots. Images already in that folder stay unless one of the same name
# replaces it; other PRs' folders are untouched. Prints each image's URL. The URLs
# name the commit, so a PR body that embeds them keeps working after a re-publish.
# Touches no checkout, index or other branch: the commit is built with git plumbing.
set -euo pipefail

pr=${1:?usage: publish.sh <PR number> <dir>}
src=${2:?usage: publish.sh <PR number> <dir>}
case $pr in *[!0-9]*) echo "publish: $pr is not a PR number" >&2; exit 2 ;; esac
branch=pr-assets

shopt -s nullglob nocaseglob
images=("$src"/*.png "$src"/*.jpg "$src"/*.jpeg "$src"/*.gif "$src"/*.webp)
[ ${#images[@]} -gt 0 ] || { echo "publish: no images in $src" >&2; exit 1; }

parent=
if git fetch -q origin "refs/heads/$branch" 2>/dev/null; then
  parent=$(git rev-parse FETCH_HEAD)
fi

# The PR's folder: what it holds already, then the new images. The last entry of
# a name wins, so a new image replaces an old one of the same name.
folder=$(
  [ -z "$parent" ] || git ls-tree "$parent:$pr" 2>/dev/null || true
  for f in "${images[@]}"; do
    printf '100644 blob %s\t%s\n' "$(git hash-object -w "$f")" "$(basename "$f")"
  done
)
subtree=$(printf '%s\n' "$folder" | awk -F'\t' 'NF { line[$2] = $0 } END { for (n in line) print line[n] }' | git mktree)
tree=$(
  { [ -z "$parent" ] || git ls-tree "$parent" | awk -F'\t' -v pr="$pr" '$2 != pr'
    printf '040000 tree %s\t%s\n' "$subtree" "$pr"
  } | git mktree
)
commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "chore: screenshots for #$pr")
git push -q origin "$commit:refs/heads/$branch" ||
  { echo "publish: $branch moved meanwhile; run publish.sh again" >&2; exit 1; }

slug=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "published ${#images[@]} images to $branch at $commit"
for f in "${images[@]}"; do
  echo "https://raw.githubusercontent.com/$slug/$commit/$pr/$(basename "$f")"
done
