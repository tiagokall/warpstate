import { QueryClient, queryOptions } from "@tanstack/react-query";
import { fetchProduct, fetchProducts, type SortOrder } from "./api";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

export const productsQuery = (q: string, sort: SortOrder) =>
  queryOptions({ queryKey: ["products", { q, sort }], queryFn: () => fetchProducts(q, sort) });

export const productQuery = (id: number) =>
  queryOptions({ queryKey: ["product", id], queryFn: () => fetchProduct(id) });
