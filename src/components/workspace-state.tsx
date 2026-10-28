"use client";

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

import type { Workspace } from "@/core/memory-types";

export type WorkspaceView = Workspace & {
  session?: {
    auth_mode: "none" | "google";
    tenancy?: "single" | "multi";
    display_name: string;
    email: string;
  };
};

type WorkspaceState = {
  organizationSlug: string;
  workspace: WorkspaceView | null;
  setWorkspace: Dispatch<SetStateAction<WorkspaceView | null>>;
};

const WorkspaceContext = createContext<WorkspaceState | null>(null);

export function WorkspaceStateProvider({ organizationSlug, children }: {
  organizationSlug: string;
  children?: ReactNode;
}) {
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  return (
    <WorkspaceContext.Provider value={{ organizationSlug, workspace, setWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspaceState(organizationSlug: string) {
  const shared = useContext(WorkspaceContext);
  const local = useState<WorkspaceView | null>(null);
  const [workspace, setWorkspace] = shared?.organizationSlug === organizationSlug
    ? [shared.workspace, shared.setWorkspace] as const
    : local;
  return [workspace?.organization.slug === organizationSlug ? workspace : null, setWorkspace] as const;
}
