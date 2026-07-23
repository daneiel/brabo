export type ServiceName = "api" | "engine";

export interface HealthStatus {
  service: ServiceName;
  status: "ok" | "error";
  timestamp: string;
  details?: Record<string, unknown>;
}
