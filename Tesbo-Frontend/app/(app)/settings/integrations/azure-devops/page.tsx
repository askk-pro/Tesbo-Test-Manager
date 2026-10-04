"use client";

import { EngineeringWorkspaceIntegration } from "@/components/integrations/EngineeringWorkspaceIntegration";

export default function AzureDevOpsWorkspaceIntegrationPage() {
  return (
    <EngineeringWorkspaceIntegration
      provider="azure-devops"
      label="Microsoft Azure DevOps"
      accountLabel="Azure DevOps organization"
    />
  );
}
