"use client";

import { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";

import { TopLoadingBar } from "@/components/ui/top-loading-bar";

export function NavigationProgress() {
  const { pending } = useLinkStatus();
  return pending ? createPortal(<TopLoadingBar />, document.body) : null;
}
