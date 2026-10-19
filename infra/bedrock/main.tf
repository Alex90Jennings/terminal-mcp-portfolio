locals {
  # Vercel's team issuer mode: https://vercel.com/docs/oidc/aws
  oidc_host = "oidc.vercel.com/${var.vercel_team_slug}"
  audience  = "https://vercel.com/${var.vercel_team_slug}"
  subjects  = [for env in var.vercel_environments : "owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:${env}"]

  tags = {
    Project   = "portfolio-mcp"
    ManagedBy = "terraform"
    Repo      = "Alex90Jennings/terminal-mcp-portfolio"
  }

  oidc_provider_arn = var.create_oidc_provider ? aws_iam_openid_connect_provider.vercel[0].arn : "arn:aws:iam::${var.aws_account_id}:oidc-provider/${local.oidc_host}"
}

# allowed_account_ids is a guard rail: this machine also holds credentials for
# other accounts, and a wrong profile must abort rather than apply.
provider "aws" {
  region              = var.aws_region
  profile             = var.aws_profile
  allowed_account_ids = [var.aws_account_id]

  default_tags {
    tags = local.tags
  }
}

resource "aws_iam_openid_connect_provider" "vercel" {
  count = var.create_oidc_provider ? 1 : 0

  url            = "https://${local.oidc_host}"
  client_id_list = [local.audience]
}

# Only this Vercel project, in the listed environments, can assume the role:
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

resource "aws_iam_role" "bedrock_chat" {
  name                 = "portfolio-mcp-bedrock-chat"
  description          = "Assumed by the portfolio's Vercel functions (OIDC) to call Claude on Bedrock. No long-lived keys."
  assume_role_policy   = data.aws_iam_policy_document.trust.json
  max_session_duration = 3600
}

# Least privilege, from AWS's Service Authorization Reference for
# bedrock-mantle: CreateInference is authorised against a project resource and
# filtered by model with the bedrock-mantle:Model condition key. Nothing else
# (no fine-tuning, files, reservations or project management).
data "aws_iam_policy_document" "invoke_claude" {
  statement {
    sid       = "InvokeAllowedClaudeModels"
    effect    = "Allow"
    actions   = ["bedrock-mantle:CreateInference"]
    resources = ["arn:aws:bedrock-mantle:${var.aws_region}:${var.aws_account_id}:project/*"]

    condition {
      test     = "StringEquals"
      variable = "bedrock-mantle:Model"
      values   = var.allowed_models
    }
  }
}

resource "aws_iam_role_policy" "invoke_claude" {
  name   = "invoke-allowed-claude-models"
  role   = aws_iam_role.bedrock_chat.id
  policy = data.aws_iam_policy_document.invoke_claude.json
}
