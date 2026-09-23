export type DecimalString = string;

export interface SessionInfo {
  session_id: string;
  expires_in: number;
}

export interface Product {
  id: string;
  name: string;
  article: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  price: DecimalString | null;
  quantity: DecimalString | null;
  stores: { name: string; quantity: DecimalString | null }[];
  attributes: Record<string, string>;
  certificates: { name: string | null; url: string }[];
  product_url: string | null;
  source: 'ekt_catalog';
}

export interface Analog {
  kind: 'catalog_analog';
  product_id: string;
  product: Product;
  score: number;
  match: string[];
  differences: string[];
  unknown: string[];
  quantity: DecimalString | null;
  recommendation: 'possible_alternative' | 'requires_review';
}

export interface Attribute {
  name: string;
  value: string;
}

export interface IdentifiedProduct {
  article: string | null;
  barcode: string | null;
  brand: string | null;
  model: string | null;
  category: string | null;
  attributes: Attribute[];
  quantity: number | null;
  unreadable_fields: string[];
  confidence: number;
}

export interface ExternalVariant {
  name: string;
  url: string;
  attributes: Attribute[];
  differences: string[];
  unknown: string[];
  kind: 'external_variant';
  recommendation: 'requires_review';
}

export interface CartProposal {
  operation_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  price_at_proposal: DecimalString;
  available_quantity: DecimalString;
  status: 'WAITING_CONFIRMATION';
  expires_at: string;
  requires_confirmation: true;
  demo: true;
}

export interface CartLine {
  product_id: string;
  product_name: string;
  quantity: number;
  price: DecimalString;
}

export interface Cart {
  items: CartLine[];
  total_quantity: number;
  total_amount: DecimalString;
  cart_url: string;
  demo: true;
}

export interface CartResult {
  operation_id: string;
  product_id: string;
  quantity: number;
  status: 'added' | 'reconfirmation_required';
  message: string;
  cart: Cart;
  pending_cart_action: CartProposal | null;
  demo: true;
  success: boolean;
  cart_url: string;
}

export interface ChatReply {
  session_id: string;
  message: string;
  cart_changed: boolean;
  pending_cart_action: CartProposal | null;
  products: Product[];
  analogs: Analog[];
  external_variants: ExternalVariant[];
  extracted: IdentifiedProduct[];
  cart: Cart | null;
  cart_url: string | null;
  demo_cart: true;
}

export type UploadReply = ChatReply;

export interface AssistantApi {
  mode: 'demo' | 'live';
  start: () => Promise<SessionInfo>;
  chat: (sessionId: string, message: string) => Promise<ChatReply>;
  upload: (sessionId: string, file: File) => Promise<ChatReply>;
  product: (id: string) => Promise<Product>;
  confirm: (sessionId: string, proposal: CartProposal) => Promise<CartResult>;
  cart: (sessionId: string) => Promise<Cart>;
  health: () => Promise<{ status: string; redis?: string }>;
}
