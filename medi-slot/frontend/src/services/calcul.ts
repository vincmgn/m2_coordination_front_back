export function calculer(expression: string): number {
  const jetons = expression.match(/\d+(?:\.\d+)?|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const lire = () => jetons[i++];
  const voir = () => jetons[i];

  function facteur(): number {
    const j = lire();
    if (j === '-') return -facteur();
    if (j === '(') {
      const v = somme();
      if (lire() !== ')') throw new Error('Parenthèse fermante attendue');
      return v;
    }
    if (j === undefined || !/^\d/.test(j)) throw new Error('Expression invalide');
    return Number(j);
  }
  function produit(): number {
    let v = facteur();
    while (voir() === '*' || voir() === '/') v = lire() === '*' ? v * facteur() : v / facteur();
    return v;
  }
  function somme(): number {
    let v = produit();
    while (voir() === '+' || voir() === '-') v = lire() === '+' ? v + produit() : v - produit();
    return v;
  }

  const resultat = somme();
  if (i < jetons.length) throw new Error('Expression invalide');
  return resultat;
}
