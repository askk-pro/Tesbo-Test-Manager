"use client";

import { EngineeringWorkspaceIntegration } from "@/components/integrations/EngineeringWorkspaceIntegration";

export default function GitHubWorkspaceIntegrationPage() {
  return (
    <EngineeringWorkspaceIntegration
      provider="github"
      label="GitHub"
      accountLabel="GitHub organization"
    />
  );
}
