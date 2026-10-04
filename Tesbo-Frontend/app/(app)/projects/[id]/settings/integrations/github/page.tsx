"use client";

import { EngineeringProjectIntegration } from "@/components/integrations/EngineeringProjectIntegration";
import {
  getGitHubProjectStatus,
  listGitHubRepositories,
  mapGitHubRepository,
  syncGitHubRequirements,
} from "@/lib/api";

export default function GitHubProjectIntegrationPage() {
  return (
    <EngineeringProjectIntegration
      provider="github"
      label="GitHub Issues"
      remoteUnitLabel="GitHub repository"
      fetchStatus={getGitHubProjectStatus}
      fetchItems={listGitHubRepositories}
      saveMapping={mapGitHubRepository}
      syncRequirements={syncGitHubRequirements}
    />
  );
}
