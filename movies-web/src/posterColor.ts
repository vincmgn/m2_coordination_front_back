export const POSTER_COLORS = ['#ffb547', '#7ce0c3', '#ff7a9a', '#b7a6ff', '#f3f1ec', '#8fc9ff']

export const posterColor = (title: string) =>
  POSTER_COLORS[[...title].reduce((sum, c) => sum + c.charCodeAt(0), 0) % POSTER_COLORS.length]!
