locals {
  # Vercel's team issuer mode: https://vercel.com/docs/oidc/aws
  oidc_host = "oidc.vercel.com/${var.vercel_team_slug}"
  audience  = "https://vercel.com/${var.vercel_team_slug}"
  subjects  = [for env in var.vercel_environments : "owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:${env}"]

  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.vercel[0].arn : "arn:aws:iam::${var.aws_account_id}:oidc-provider/${local.oidc_host}"
  cv_object_arn     = "arn:aws:s3:::${var.cv_bucket}/${var.cv_key}"
}

# allowed_account_ids is a guard rail: a wrong profile aborts rather than applies.
provider "aws" {
  region              = var.aws_region
  profile             = var.aws_profile
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = {
      Project   = "portfolio-mcp"
      ManagedBy = "terraform"
      Repo      = "Alex90Jennings/terminal-mcp-portfolio"
    }
  }
}

# ── The bucket stays private ─────────────────────────────────────────────────
# The bucket and object already exist (uploaded by hand); this manages only their
# access settings. Import before the first apply:
#   terraform import aws_s3_bucket_public_access_block.cv cv-alex-jennings
#   terraform import aws_s3_bucket_ownership_controls.cv cv-alex-jennings
# (Block Public Access was switched on by hand on 2026-10-20; the import adopts it unchanged.)
data "aws_s3_bucket" "cv" {
  bucket = var.cv_bucket
}

resource "aws_s3_bucket_public_access_block" "cv" {
  bucket                  = data.aws_s3_bucket.cv.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

# ACLs off: access is decided by IAM alone.
resource "aws_s3_bucket_ownership_controls" "cv" {
  bucket = data.aws_s3_bucket.cv.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# A bucket policy that only denies: requests without TLS. It grants nothing to anyone.
data "aws_iam_policy_document" "bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [data.aws_s3_bucket.cv.arn, "${data.aws_s3_bucket.cv.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "cv" {
  bucket = data.aws_s3_bucket.cv.id
  policy = data.aws_iam_policy_document.bucket.json

  # Block Public Access is in place before any policy is attached.
  depends_on = [aws_s3_bucket_public_access_block.cv]
}

# ── The role the Vercel function assumes ─────────────────────────────────────
# Vercel's team issuer: https://oidc.vercel.com/<team>, audience https://vercel.com/<team>
# (verified against the issuer's discovery document; the project uses Team issuer mode).
resource "aws_iam_openid_connect_provider" "vercel" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://${local.oidc_host}"
  client_id_list = [local.audience]
}

# Only this Vercel project, in the listed environments (production by default):
# both the audience and the exact subject must match.
data "aws_iam_policy_document" "trust" {
  statement {
    sid     = "VercelProjectOidc"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:aud"
      values   = [local.audience]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_host}:sub"
      values   = local.subjects
    }
  }
}

resource "aws_iam_role" "cv_download" {
  name                 = "VercelPortfolioCVRole"
  description          = "Assumed by the portfolio's Vercel functions (OIDC) to read Alex's CV. No long-lived keys."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
}

# One action on one object: no listing, no writes, no deletes, no other keys.
data "aws_iam_policy_document" "read_cv" {
  statement {
    sid       = "ReadTheCvOnly"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = [local.cv_object_arn]
  }
}

resource "aws_iam_role_policy" "read_cv" {
  name   = "read-cv-object"
  role   = aws_iam_role.cv_download.id
  policy = data.aws_iam_policy_document.read_cv.json
}
