"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui";

export default function ScheduleRunsPage() {
  const params = useParams();
  const router = useRouter();
  useEffect(() => {
    router.replace("/projects/" + String(params.id) + "/qa-operations?tab=schedules");
  }, [params.id, router]);
  return <PageLoader variant="screen" label="Opening QA Operations schedules…" />;
}
