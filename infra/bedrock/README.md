# Bedrock access for the portfolio assistant

Terraform for the one thing the AI assistant needs in AWS: an IAM role that
the portfolio's Vercel functions can assume through OIDC to call Claude on
Amazon Bedrock. No access keys exist anywhere.

**Not applied yet.** Review it, then apply it yourself once Bedrock access is enabled.

## What it creates

| Resource | Why |
| :-- | :-- |
| `aws_iam_openid_connect_provider.vercel` | Trusts Vercel's OIDC issuer for your team (`https://oidc.vercel.com/<team>`), audience `https://vercel.com/<team>`. Skip it with `create_oidc_provider = false` if the account already has one. |
| `aws_iam_role.bedrock_chat` | Assumable **only** by your Vercel project in the listed environments (default: production). Both `aud` and the exact `sub` (`owner:<team>:project:<project>:environment:<env>`) must match. Sessions last at most an hour. |
| `aws_iam_role_policy.invoke_claude` | One action, `bedrock-mantle:CreateInference`, on this account's Bedrock projects in this region, and only when the `bedrock-mantle:Model` condition is one of the three candidate models. No file, fine-tuning, reservation or project-management permissions. |

The action, resource ARN format and condition key come from AWS's Service
Authorization Reference for `bedrock-mantle` (machine-readable copy:
`https://servicereference.us-east-1.amazonaws.com/v1/bedrock-mantle/bedrock-mantle.json`).

`allowed_account_ids` pins the account, as in operafy-infra: a wrong profile aborts instead of applying.

## Activating Bedrock (in order)

1. **Enable model access.** In the AWS console for this account, open Amazon Bedrock in `eu-west-1` and request access to Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5. Anthropic models usually need a one-time use-case form, and these models are billed through AWS Marketplace, so the user doing this may need Marketplace subscribe permissions.

   As of 2026-10-19, every Claude call from this account returned *"not available for this account"* (403 in `us-east-1`) or *"model does not exist"* (404 in `eu-west-1`), even for Opus 4.8, which is open to all Bedrock customers. So access has not been granted yet.
2. **Re-run the access check** with the local profile. One call, `max_tokens: 1`, a fraction of a cent: `AWS_PROFILE=terraform node id-check.mjs eu-west-1 anthropic.claude-opus-5-5`. If `eu-west-1` still returns 404 while `us-east-1` works, set `aws_region` and `AI_BEDROCK_REGION` to `us-east-1`; the price is the same on the global endpoint.
3. **Create the Vercel project**, enable OIDC (team issuer mode), and note the team slug and project name.
4. **Apply:**
   ```bash
   cp terraform.tfvars.example terraform.tfvars    # account id, team slug, project name
   terraform init -backend-config="bucket=operafy-tfstate-<account>"
   terraform plan
   terraform apply
   ```
5. **Configure the app** in Vercel: `AI_PROVIDER=bedrock`, `AI_BEDROCK_ROLE_ARN=<role_arn output>`, `AI_BEDROCK_REGION=eu-west-1`, plus `CHAT_TRANSCRIPT_SECRET` and the Upstash variables (see `apps/web/.env.example`).
6. **Verify:** `bedrock-mantle:Model` is matched against the model id in each request (`anthropic.claude-opus-5-5`). If a deployed call is refused with AccessDenied, check that value in CloudTrail and adjust `allowed_models`; never widen the policy to `*`.

## Validation

`terraform fmt -check` and `terraform validate` pass with Terraform 1.16.6 (run 2026-10-19, without a backend). Nothing has been planned or applied against the account.
