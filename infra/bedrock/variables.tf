variable "aws_account_id" {
  description = "The only AWS account this configuration may touch. Terraform aborts if the credentials resolve to any other."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account id."
  }
}

variable "aws_region" {
  description = "Region of the Bedrock Mantle endpoint the app calls (AI_BEDROCK_REGION)."
  type        = string
  default     = "eu-west-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile used to apply this configuration."
  type        = string
  default     = "terraform"
}

variable "vercel_team_slug" {
  description = "The Vercel team slug, from the team URL. Used for the OIDC issuer, audience and subject."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.vercel_team_slug))
    error_message = "vercel_team_slug must be lowercase letters, digits and hyphens."
  }
}

variable "vercel_project_name" {
  description = "The Vercel project allowed to assume the role."
  type        = string
}

variable "vercel_environments" {
  description = "Vercel environments allowed to call Bedrock. Development is deliberately excluded by default."
  type        = list(string)
  default     = ["production"]

  validation {
    condition     = length(var.vercel_environments) > 0 && alltrue([for env in var.vercel_environments : contains(["production", "preview", "development"], env)])
    error_message = "vercel_environments must be a non-empty subset of production, preview and development."
  }
}

variable "allowed_models" {
  description = "Bedrock model ids the role may invoke (the bedrock-mantle:Model condition)."
  type        = list(string)
  default     = ["anthropic.claude-opus-5-5", "anthropic.claude-sonnet-5-5", "anthropic.claude-haiku-5-5"]
}

variable "create_oidc_provider" {
  description = "Create the Vercel OIDC identity provider. Set false if the account already has one for this team."
  type        = bool
  default     = true
}
