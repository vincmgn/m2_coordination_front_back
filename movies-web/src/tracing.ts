import { context, propagation, trace, type Context } from '@opentelemetry/api'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch'
import { resourceFromAttributes } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  StackContextManager,
  TraceIdRatioBasedSampler,
  TracerProvider,
  type ReadableSpan,
  type Span,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_URL_FULL } from '@opentelemetry/semantic-conventions'

export class StripQueryProcessor implements SpanProcessor {
  onStart(span: Span, _parentContext: Context): void {
    const url = span.attributes[ATTR_URL_FULL]
    if (typeof url === 'string' && url.includes('?')) span.setAttribute(ATTR_URL_FULL, url.slice(0, url.indexOf('?')))
  }
  onEnd(_span: ReadableSpan): void {}
  forceFlush(): Promise<void> {
    return Promise.resolve()
  }
  shutdown(): Promise<void> {
    return Promise.resolve()
  }
}

export interface TracingOptions {
  processor?: SpanProcessor
}

export function startTracing(options: TracingOptions = {}): TracerProvider {
  const processor =
    options.processor ??
    new BatchSpanProcessor({
      exporter: new OTLPTraceExporter({ url: `${location.origin}/otlp/v1/traces` }),
      scheduledDelayMillis: 5000,
    })

  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'movies-web',
      [ATTR_SERVICE_VERSION]: import.meta.env.VITE_GIT_SHA ?? 'local',
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(1) }),
    spanProcessors: [new StripQueryProcessor(), processor],
  })
  trace.setGlobalTracerProvider(provider)

  context.setGlobalContextManager(new StackContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())

  registerInstrumentations({
    instrumentations: [new FetchInstrumentation({ ignoreUrls: [/\/otlp\//] })],
  })

  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void provider.forceFlush()
  })
  return provider
}
