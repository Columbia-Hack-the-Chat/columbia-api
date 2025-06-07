export interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string;
  created_at: string;
}

export interface Order {
  id: string;
  order_id: number;
  customer_id: string;
  product: string[];
  total: number;
  created_at: string;
  review_status: string;
}

export interface Review {
  id: string;
  order_id: string;
  customer_id: string;
  rating: number;
  comment: string;
  status: string;
  created_at: string;
}

export interface ReviewWithRelations extends Review {
  customer: Pick<Customer, 'name' | 'email'>;
  order: Pick<Order, 'order_id' | 'total'>;
} 