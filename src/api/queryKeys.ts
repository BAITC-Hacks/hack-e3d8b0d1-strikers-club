export const queryKeys = {
  cart: (sessionId: string) => ['cart', sessionId] as const,
  product: (productId: string | null) => ['product', productId] as const,
};
