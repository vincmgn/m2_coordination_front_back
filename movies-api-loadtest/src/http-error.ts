// Erreur métier : le gestionnaire d'erreurs de src/index.ts renvoie { error: message } avec ce status.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
