// TP OpenTelemetry : TP_TICKETS=1 réactive les trois défauts des tickets T1, T2, T3 (à diagnostiquer dans Jaeger).
// TP_TICKETS=0 (ou absent) : comportement corrigé. Voir TRACES.md à la racine du dépôt.
export const TP_TICKETS = process.env.TP_TICKETS === "1";
