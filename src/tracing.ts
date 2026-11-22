import {
  context,
  propagation,
  Span,
  SpanStatusCode,
  trace,
  type Attributes,
} from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

/**
 * Returns true when OpenTelemetry tracing is enabled via OTEL_EXPORTER_OTLP_ENDPOINT.
 */
export function isTracingEnabled(): boolean {
  return Boolean(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
}

/**
 * Initialize the OpenTelemetry NodeSDK if OTEL_EXPORTER_OTLP_ENDPOINT is configured.
 * Safe to call multiple times; subsequent calls return the existing SDK instance.
 */
export function initTracing(): NodeSDK | null {
  if (sdk) {
    return sdk;
  }

  if (!isTracingEnabled()) {
    return null;
  }

  const traceExporter = new OTLPTraceExporter();

  sdk = new NodeSDK({
    serviceName:
      process.env.OTEL_SERVICE_NAME || "stellar-footprint-service",
    traceExporter,
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();
  return sdk;
}

/**
 * Gracefully flush and shut down the OpenTelemetry SDK if initialized.
 */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) {
    return;
  }
  const activeSdk = sdk;
  sdk = null;
  await activeSdk.shutdown();
}

/**
 * Retrieve the OpenTelemetry tracer for this service.
 */
export function getTracer(name = "stellar-footprint-service") {
  return trace.getTracer(name);
}

/**
 * Execute an operation within an active OpenTelemetry span, recording errors and
 * ending the span automatically.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  attributes?: Attributes,
): Promise<T> {
  return getTracer().startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.recordException(err);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err.message,
      });
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Inject active W3C Trace Context headers (traceparent, tracestate) into an
 * outgoing request headers object.
 */
export function injectTraceHeaders(
  headers: Record<string, string> = {},
): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}
