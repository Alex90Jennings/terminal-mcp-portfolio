# CV download

Alex's CV is a PDF in a **private** S3 bucket, downloaded through the portfolio:

```text
Browser ── GET /api/cv ──▶ Vercel function ── OIDC ──▶ STS: short-lived role session
                                     │                          (s3:GetObject on one object)
                                     └──── GetObject ──▶ S3 (private) ── streamed PDF ──▶ Browser
```

- **Bucket and object:** `s3://cv-alex-jennings/cv-alex-jennings.pdf`, in eu-west-1.
- **Route:** `apps/web/src/app/api/cv/route.ts`. The logic is in `apps/web/src/server/cv.ts`.
- **Terminal:** `cv` links `/api/cv` when the deployment is configured, and shows a summary otherwise. Plain-English requests for the CV ("How can I download Alex's CV?") run `cv` directly instead of going to the AI assistant, and the assistant is told to point to `cv` when the CV comes up. The CV's contents are never AI knowledge.
- **Infrastructure:** `infra/cv/` (Terraform). Applied on 2026-10-20; the Vercel variables and a production deploy are still to do.

## How authentication works

1. Vercel gives each function invocation an OIDC token that identifies the team, project and environment.
2. `awsCredentialsProvider({ roleArn })` from `@vercel/oidc-aws-credentials-provider` (Vercel's package; the older `@vercel/functions/oidc` export is deprecated) exchanges it with AWS STS (`AssumeRoleWithWebIdentity`) for a session of the role `VercelPortfolioCVRole`, lasting at most an hour.
3. The S3 client uses only those credentials, never the default credential chain. It calls `GetObject` on the one configured object.

Vercel reuses a function's token for up to 90 minutes; each lasts two hours. OIDC federation is available on every Vercel plan, Hobby included.

No AWS access keys exist. No AWS credentials, bucket name or object URL ever reach the browser. The browser only sees `/api/cv`.

## What the route does
| | |
| :-- | :-- |
| Methods | `GET` only (405 otherwise) |
| Object | Fixed by configuration: the visitor's path and query are ignored, so no other key can be requested, and keys with `/` or `..` are refused at configuration time |
| Streaming | The first chunk is checked (`%PDF-`), then the rest streams through; nothing beyond one chunk is buffered |
| Size | 10 MB at most: refused up front if S3 reports more, and the stream is cut if it runs past the cap anyway |
| Response | `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="cv-alex-jennings.pdf"`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=0, must-revalidate` |
| Not configured | 404 `No CV is published.` |
| S3 or credentials failure, timeout (8 s), wrong type, too large | 502 `The CV isn't available right now. Please try again later.` The log records only the error's name (for example `AccessDenied`), never a bucket, key, ARN or message |

The CV is never part of the portfolio's knowledge: the terminal, the MCP server and the AI assistant can't read it.

## Verified values (2026-10-20)

Read from the issuer's discovery document (`https://oidc.vercel.com/alexjennings10s-projects/.well-known/openid-configuration`) and the project's settings, not assumed:

| | |
| :-- | :-- |
| Vercel team slug | `alexjennings10s-projects` |
| Vercel project | `terminal-mcp-portfolio` (root directory `apps/web`) |
| OIDC | enabled, **Team** issuer mode |
| Issuer (`iss`) | `https://oidc.vercel.com/alexjennings10s-projects` |
| IAM identity provider URL | `oidc.vercel.com/alexjennings10s-projects` |
| Audience (`aud`, the default) | `https://vercel.com/alexjennings10s-projects` |
| Subject (`sub`), production | `owner:alexjennings10s-projects:project:terminal-mcp-portfolio:environment:production` |

If the team or project is renamed, the subject changes and the role stops trusting the deployment until the trust policy is updated.

## AWS configuration (Terraform in `infra/cv/`, applied 2026-10-20)

**The bucket, private:**
- **Block Public Access:** all four settings on: `BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`.
- **Object ownership:** `BucketOwnerEnforced`, so ACLs are disabled.
- **Bucket policy:** it only denies requests without TLS, and grants nothing.

**IAM permissions policy** for the role `VercelPortfolioCVRole`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadTheCvOnly",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::cv-alex-jennings/cv-alex-jennings.pdf"
    }
  ]
}
```

No `s3:ListBucket`, so there is no listing. A missing object reads as access denied rather than not found. No `PutObject`, `DeleteObject` or any other action. The object is encrypted with S3-managed keys (SSE-S3), so no KMS permission is needed.

**Trust policy.** Only `<ACCOUNT_ID>` to fill in:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VercelProjectOidc",
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/oidc.vercel.com/alexjennings10s-projects" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/alexjennings10s-projects:aud": "https://vercel.com/alexjennings10s-projects",
          "oidc.vercel.com/alexjennings10s-projects:sub": "owner:alexjennings10s-projects:project:terminal-mcp-portfolio:environment:production"
        }
      }
    }
  ]
}
```

Only the production deployments of that one project can assume the role. Preview and development can't, so `/api/cv` returns 502 there unless you add those environments to `vercel_environments`.

**OIDC identity provider:** `infra/cv` creates it (`create_oidc_provider = true`): URL `https://oidc.vercel.com/alexjennings10s-projects`, client id (audience) `https://vercel.com/alexjennings10s-projects`. On 2026-10-20 the account had no Vercel provider (only GitHub Actions'). `infra/bedrock` leaves it alone by default; the assistant uses the Anthropic API, so Bedrock needn't be applied.

**Applying (when approved):**

```bash
cd infra/cv
cp terraform.tfvars.example terraform.tfvars   # fill in the account id; team and project are already set
terraform init -backend-config="bucket=operafy-tfstate-<account>"
terraform import aws_s3_bucket_public_access_block.cv cv-alex-jennings
terraform import aws_s3_bucket_ownership_controls.cv cv-alex-jennings
terraform plan    # review: the role, its one-object policy, the four Block Public Access settings, the TLS-only bucket policy
terraform apply
```

Block Public Access is already on (all four, set by hand); the import adopts it unchanged. The plan should create exactly: the OIDC provider, the role, its inline policy and the bucket policy, and change nothing else.

Cost: IAM, the OIDC provider and STS are free; each download is one S3 GET plus about 114 KB of transfer.

## Vercel configuration

In the project's settings → Environment Variables, for **Production**:

| Variable | Value |
| :-- | :-- |
| `CV_S3_BUCKET` | `cv-alex-jennings` |
| `CV_S3_KEY` | `cv-alex-jennings.pdf` (the default) |
| `CV_S3_REGION` | `eu-west-1` (the default) |
| `CV_AWS_ROLE_ARN` | the `role_arn` output, `arn:aws:iam::<ACCOUNT_ID>:role/VercelPortfolioCVRole` |

OIDC must be enabled for the project (Settings → Security → Secure backend access with OIDC federation, **Team** issuer mode); it already is. The code reads `CV_S3_REGION`, not Vercel's `AWS_REGION` (which is the function's own region, `iad1` here), so S3 calls always go to eu-west-1. Downloads cross from the US to Ireland; setting the function region to `dub1` would shorten that, but isn't required. None of these values is secret, and none is exposed to the browser: they have no `NEXT_PUBLIC_` prefix and are read only by the server. The page decides at build time whether to offer the link (all four values present and well formed), so redeploy after setting them.

Locally, without an OIDC token, the CV isn't offered. To try the real path locally, run `vercel env pull` (which provides a short-lived `VERCEL_OIDC_TOKEN`) with development added to the trust policy. The default AWS profile is never used.

## Verifying

**Direct access is denied** (checked 2026-10-20 after applying: Block Public Access all on, policy not public, anonymous GET 403; IAM simulation allows only GetObject on the CV and denies Put, Delete, ListBucket and other keys):

```bash
curl -sI https://cv-alex-jennings.s3.eu-west-1.amazonaws.com/cv-alex-jennings.pdf | head -1   # 403 Forbidden
aws s3api get-public-access-block --bucket cv-alex-jennings --profile terraform                 # all four true
aws s3api get-bucket-policy-status --bucket cv-alex-jennings --profile terraform                # "IsPublic": false
```

**Downloads through Vercel work** (after deploying with the variables set):

```bash
curl -sI https://builtbyaj.io/api/cv
# 200, content-type: application/pdf, content-disposition: attachment; filename="cv-alex-jennings.pdf"
curl -s https://builtbyaj.io/api/cv -o cv.pdf && file cv.pdf   # PDF document
curl -s -o /dev/null -w '%{http_code}\n' "https://builtbyaj.io/api/cv?key=../other"   # still the CV (the query is ignored)
```

In the terminal, `cv` shows **Download: CV (PDF)**. A preview deployment should answer 502, because the role trusts production only.

## Tests
- **`apps/web/test/cv-and-modes.test.ts`:** configuration (traversal, slashes, malformed values refused), streaming (the response starts before S3 finishes), headers, the visitor's query ignored, 404 and 405, S3 failures as a plain 502 with no details logged, the type, size and PDF checks (with the S3 stream cancelled), the mid-stream size cap, the CV never in the knowledge, and the `cv` link.
- **`apps/web/test/cv-s3.test.ts`:** the real S3 path with AWS mocked at its boundary. It reads exactly the configured object with the role's OIDC credentials and reuses the client. Through the route: a successful download (streamed, attachment, no AWS headers), a missing object (`AccessDenied` without ListBucket, and `NoSuchKey`), an AWS service error, STS refusing the token, an expired token, no token at all, and an empty body: each a plain 502 whose response and log reveal nothing about AWS.
- **E2E:** `/api/cv` answers 404 when unconfigured, and no content file is served over HTTP.
