"use client";

import { ErrorBox } from "@/components/ErrorBox";

export default function Error(props: { error: Error; reset: () => void }) {
  return <ErrorBox {...props} />;
}
