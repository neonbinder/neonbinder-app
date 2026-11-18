#!/usr/bin/env bash
# Mask private infrastructure details in a log stream before it becomes a
# public CI artifact (the repo is public, so artifacts are world-readable).
#
#   redact-ci-log.sh < raw.jsonl > safe.jsonl
#
# Masks, line by line, keeping every line valid JSON when it was valid JSON
# (replacements contain no quotes or backslashes):
#   - object-store hosts (R2, S3, GCS, Azure blob, Spaces, B2, Vercel blob),
#     including path-style bucket segments, and gs:// s3:// r2:// buckets
#   - bucket names in key/value or quoted form ("bucket":"x", Bucket=x, bucket 'x')
#   - 32-hex account identifiers
#   - Convex, Vercel and Cloud Run hostnames, Convex deployment ids and
#     "deployment":"..." values
#   - email addresses
#   - any literal in REDACT_LITERALS (newline separated, 4+ chars), e.g. this
#     run's own Convex preview deployment name
# Function names, timings and structured {"msg": ...} lines are untouched.
#
# Fails closed: without perl it exits 127 and writes nothing, and the caller
# must then drop the artifact rather than publish an unredacted log.
#
#
set -uo pipefail

if ! command -v perl >/dev/null 2>&1; then
  echo "redact-ci-log: perl not found; refusing to pass the stream through" >&2
  exit 127
fi

REDACT_LITERALS="${REDACT_LITERALS:-}" exec perl -pe '
  BEGIN {
    @lit = grep { length($_) >= 4 } split(/\n/, $ENV{REDACT_LITERALS} // "");
    # Longest first so a name that contains another is masked whole.
    @lit = sort { length($b) <=> length($a) } @lit;
  }
  for my $l (@lit) { s/\Q$l\E/<redacted>/g; }

  # Path-style bucket segment first, then the host itself.
  s{(storage\.googleapis\.com|s3[A-Za-z0-9.-]*\.amazonaws\.com|r2\.cloudflarestorage\.com)/[^/"\\\s?]+}{$1/<bucket>}g;
  s{[A-Za-z0-9._-]+\.(?:r2\.cloudflarestorage\.com|r2\.dev|s3[A-Za-z0-9.-]*\.amazonaws\.com|storage\.googleapis\.com|digitaloceanspaces\.com|backblazeb2\.com|blob\.core\.windows\.net|public\.blob\.vercel-storage\.com)}{<storage-host>}g;
  s{\b(?:r2|s3|gs)://[^/"\\\s]+}{<bucket-uri>}g;

  # "bucket":"x"  \"bucket\":\"x\"  Bucket=x  bucketName: x
  s{([Bb]ucket[A-Za-z_]*(?:\\?")?\s*[:=]\s*(?:\\?")?)[A-Za-z0-9][A-Za-z0-9._-]*}{$1<bucket>}g;
  # bucket "x"  bucket \x27x\x27  bucket name `x`
  s{([Bb]ucket (?:name )?(?:\\?["\x27`]))[^"\x27`\\\s]+}{$1<bucket>}g;

  # 32-hex account ids (R2 account id, similar).
  s{(?<![0-9A-Za-z])[0-9a-f]{32}(?![0-9A-Za-z])}{<hex32>}g;

  # "deployment":"name" (bsc_call_summary and similar), plain or escaped JSON.
  s{([Dd]eployment[A-Za-z]*\\?"\s*:\s*\\?")[^"\\]+}{$1<convex-deployment>}g;

  # Hosts and deployment ids.
  s{[A-Za-z0-9-]+\.convex\.(?:cloud|site)}{<convex-host>}g;
  s{[A-Za-z0-9-]+\.vercel\.app}{<preview-host>}g;
  s{[A-Za-z0-9-]+\.[a-z0-9]+-uc\.a\.run\.app}{<run-host>}g;
  s{[A-Za-z0-9.-]+\.run\.app}{<run-host>}g;
  s{\b(?:dev|prod|preview):[a-z]+-[a-z]+-[0-9]+}{<convex-deployment>}g;

  s{[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}}{<email>}g;
'
