"use client";

import { useEffect } from "react";
import { claimOrderAccess } from "@/server/actions/customer";

/** Fires once when an order page is opened through its access link. Renders nothing. */
export function ClaimAccess({ orderId, token }: { orderId: string; token: string | undefined }) {
  useEffect(() => {
    if (token) void claimOrderAccess(orderId, token);
  }, [orderId, token]);
  return null;
}
