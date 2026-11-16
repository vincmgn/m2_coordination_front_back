// Traces du navigateur (OpenTelemetry). Appelé par main.ts avant createApp : le premier fetch est déjà tracé.
//
// Chaque fetch devient un span client et part avec l'en-tête W3C traceparent ; l'API (instrumentée) rattache
// son span serveur à ce span. Les spans du navigateur partent par lots vers /otlp/v1/traces, même origine que
// la page : nginx relaie au collecteur, aucun réglage CORS.
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

// Garde-fou : la saisie d'une recherche (?q=…) ne doit pas quitter le navigateur.
// onStart est appelé à la création du span, quand ses attributs sont encore modifiables.
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
  // Processeur d'export ; par défaut, envoi par lots vers /otlp/. Les tests passent un SimpleSpanProcessor en mémoire.
  processor?: SpanProcessor
}

export function startTracing(options: TracingOptions = {}): TracerProvider {
  const processor =
    options.processor ??
    new BatchSpanProcessor({
      exporter: new OTLPTraceExporter({ url: `${location.origin}/otlp/v1/traces` }),
      scheduledDelayMillis: 5000,
    })

  // 1. Fournisseur : nom du service dans Jaeger, à côté de movies-api ; version = commit du build.
  const provider = new TracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'movies-web',
      [ATTR_SERVICE_VERSION]: import.meta.env.VITE_GIT_SHA ?? 'local',
    }),
    // 2. Tout garder en formation. En production, 0.1 garderait une trace sur dix ; le back suit la décision.
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(1) }),
    // 3. Le garde-fou d'abord (il modifie le span à sa création), puis l'export.
    spanProcessors: [new StripQueryProcessor(), processor],
  })
  trace.setGlobalTracerProvider(provider)

  // 4. Sans gestionnaire de contexte ni propagateur, les spans existent mais traceparent ne part pas.
  context.setGlobalContextManager(new StackContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())

  // 5. Un span par fetch, sauf l'envoi des traces lui-même (sinon chaque lot en crée un autre).
  registerInstrumentations({
    instrumentations: [new FetchInstrumentation({ ignoreUrls: [/\/otlp\//] })],
  })

  // Les spans attendent leur lot (≈ 5 s) : on vide le tampon quand la page passe en arrière-plan ou se ferme,
  // sinon les derniers spans (ex. une réservation juste avant de quitter) sont perdus.
  addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void provider.forceFlush()
  })
  return provider
}
