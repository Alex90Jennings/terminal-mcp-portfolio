variable "aws_account_id" {
  description = "The only AWS account this configuration may touch. Terraform aborts if the credentials resolve to any other."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a 12-digit AWS account id."
  }
}

variable "aws_region" {
  description = "Region of the CV bucket (CV_S3_REGION)."
  type        = string
  default     = "eu-west-1"
}

variable "aws_profile" {
  description = "Local AWS CLI profile used to apply this configuration."
  type        = string
  default     = "terraform"
}

variable "cv_bucket" {
  description = "The existing private bucket holding the CV (CV_S3_BUCKET)."
  type        = string
  default     = "cv-alex-jennings"
}

variable "cv_key" {
  description = "The CV object's key (CV_S3_KEY). The role may read this object and nothing else."
  type        = string
  default     = "cv-alex-jennings.pdf"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._-]*$", var.cv_key)) && !strcontains(var.cv_key, "..")
    error_message = "cv_key must be one object at the bucket root: no slashes or '..'."
  }
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
  description = "Vercel environments allowed to download the CV through the role. Production only by default."
  type        = list(string)
  default     = ["production"]

  validation {
    condition     = length(var.vercel_environments) > 0 && alltrue([for env in var.vercel_environments : contains(["production", "preview", "development"], env)])
    error_message = "vercel_environments must be a non-empty subset of production, preview and development."
  }
}

variable "create_oidc_provider" {
  description = "Create the Vercel OIDC identity provider. This module owns it; set false only if something else already created it for this team: an account has one provider per issuer."
  type        = bool
  default     = true
}
