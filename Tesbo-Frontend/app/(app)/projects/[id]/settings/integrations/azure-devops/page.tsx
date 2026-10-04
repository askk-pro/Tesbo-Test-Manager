"use client";

import { EngineeringProjectIntegration } from "@/components/integrations/EngineeringProjectIntegration";
import {
  getAzureDevOpsProjectStatus,
  listAzureDevOpsProjects,
  mapAzureDevOpsProject,
  syncAzureDevOpsRequirements,
} from "@/lib/api";

export default function AzureDevOpsProjectIntegrationPage() {
  return (
    <EngineeringProjectIntegration
      provider="azure-devops"
      label="Microsoft Azure DevOps"
      remoteUnitLabel="Azure DevOps project"
      fetchStatus={getAzureDevOpsProjectStatus}
      fetchItems={listAzureDevOpsProjects}
      saveMapping={mapAzureDevOpsProject}
      syncRequirements={syncAzureDevOpsRequirements}
    />
  );
}
