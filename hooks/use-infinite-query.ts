'use client'

import { createClient } from '@/lib/supabase/client'
import { PostgrestQueryBuilder, type PostgrestClientOptions } from '@supabase/postgrest-js'
import { type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useSyncExternalStore } from 'react'

const supabase = createClient()

// The following types are used to make the hook type-safe. It extracts the database type from the supabase client.
type SupabaseClientType = typeof supabase

// Utility type to check if the type is any
type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N

// Extracts the database type from the supabase client. If the supabase client doesn't have a type, it will fallback properly.
type Database =
  SupabaseClientType extends SupabaseClient<infer U>
  ? IfAny<
    U,
    {
      public: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Tables: Record<string, { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: any[] }>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Views: Record<string, { Row: Record<string, unknown>; Relationships: any[] }>
        Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
      }
    },
    U
  >
  : {
    public: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Tables: Record<string, { Row: Record<string, unknown>; Insert: Record<string, unknown>; Update: Record<string, unknown>; Relationships: any[] }>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Views: Record<string, { Row: Record<string, unknown>; Relationships: any[] }>
      Functions: Record<string, { Args: Record<string, unknown>; Returns: unknown }>
    }
  }

// Change this to the database schema you want to use
type DatabaseSchema = Database['public']

// Extracts the table names from the database type
type SupabaseTableName = keyof DatabaseSchema['Tables']

// Extracts the table definition from the database type
type SupabaseTableData<T extends SupabaseTableName> = DatabaseSchema['Tables'][T]['Row']

// Default client options for PostgrestQueryBuilder
type DefaultClientOptions = PostgrestClientOptions

type SupabaseSelectBuilder<T extends SupabaseTableName> = ReturnType<
  PostgrestQueryBuilder<
    DefaultClientOptions,
    DatabaseSchema,
    DatabaseSchema['Tables'][T],
    T
  >['select']
>

// A function that modifies the query. Can be used to sort, filter, etc. If .range is used, it will be overwritten.
type SupabaseQueryHandler<T extends SupabaseTableName> = (
  query: SupabaseSelectBuilder<T>
) => SupabaseSelectBuilder<T>

interface UseInfiniteQueryProps<T extends SupabaseTableName> {
  // The table name to query
  tableName: T
  // The columns to select, defaults to `*`
  columns?: string
  // The number of items to fetch per page, defaults to `20`
  pageSize?: number
  // A function that modifies the query. Can be used to sort, filter, etc. If .range is used, it will be overwritten.
  trailingQuery?: SupabaseQueryHandler<T>
}

interface StoreState<TData, T extends SupabaseTableName> {
  data: TData[]
  count: number
  isSuccess: boolean
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  hasInitialFetch: boolean
  tableName: T
  columns: string
  pageSize: number
  trailingQuery?: SupabaseQueryHandler<T>
}

type Listener = () => void

function createStore<TData extends SupabaseTableData<T>, T extends SupabaseTableName>(
  props: UseInfiniteQueryProps<T>
) {
  const { tableName, columns = '*', pageSize = 20, trailingQuery } = props

  let state: StoreState<TData, T> = {
    data: [],
    count: 0,
    isSuccess: false,
    isLoading: false,
    isFetching: false,
    error: null,
    hasInitialFetch: false,
    tableName,
    columns,
    pageSize,
    trailingQuery,
  }

  const listeners = new Set<Listener>()

  const notify = () => {
    listeners.forEach((listener) => listener())
  }

  const setState = (newState: Partial<StoreState<TData, T>>) => {
    state = { ...state, ...newState }
    notify()
  }

  const fetchPage = async (skip: number) => {
    if (state.hasInitialFetch && (state.isFetching || state.count <= state.data.length)) return

    setState({ isFetching: true })

    let query = supabase
      .from(tableName)
      .select(columns, { count: 'exact' }) as unknown as SupabaseSelectBuilder<T>

    if (trailingQuery) {
      query = trailingQuery(query)
    }
    const { data: newData, count, error } = await query.range(skip, skip + pageSize - 1)

    if (error) {
      console.error('An unexpected error occurred in useInfiniteQuery:', error instanceof Error ? error : JSON.stringify(error))
      setState({ error: error as unknown as Error })
    } else {
      setState({
        data: [...state.data, ...(newData as TData[])],
        count: count || 0,
        isSuccess: true,
        error: null,
      })
    }
    setState({ isFetching: false })
  }

  const fetchNextPage = async () => {
    if (state.isFetching) return
    await fetchPage(state.data.length)
  }

  const initialize = async () => {
    setState({ isLoading: true, isSuccess: false, data: [] })
    await fetchNextPage()
    setState({ isLoading: false, hasInitialFetch: true })
  }

  return {
    getState: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    fetchNextPage,
    initialize,
  }
}

// Initial state helper with correct types
function getInitialState<TData, T extends SupabaseTableName>(tableName: T, columns: string, pageSize: number): StoreState<TData, T> {
  return {
    data: [],
    count: 0,
    isSuccess: false,
    isLoading: false,
    isFetching: false,
    error: null,
    hasInitialFetch: false,
    tableName,
    columns,
    pageSize,
  }
}

function useInfiniteQuery<
  TData extends SupabaseTableData<T>,
  T extends SupabaseTableName = SupabaseTableName,
>(props: UseInfiniteQueryProps<T>) {
  const { tableName, columns = '*', pageSize = 20 } = props

  // Cache the initial state for getServerSnapshot to avoid infinite loops
  const initialState = useRef(getInitialState<TData, T>(tableName, columns, pageSize)).current

  const storeRef = useRef<ReturnType<typeof createStore<TData, T>> | null>(null)

  if (!storeRef.current) {
    storeRef.current = createStore<TData, T>(props)
  }

  const state = useSyncExternalStore(
    storeRef.current.subscribe,
    () => storeRef.current!.getState(),
    () => initialState
  )

  useEffect(() => {
    // Recreate store if props change significantly
    if (
      storeRef.current &&
      storeRef.current.getState().hasInitialFetch &&
      (props.tableName !== storeRef.current.getState().tableName ||
        props.columns !== storeRef.current.getState().columns ||
        props.pageSize !== storeRef.current.getState().pageSize ||
        props.trailingQuery !== storeRef.current.getState().trailingQuery)
    ) {
      storeRef.current = createStore<TData, T>(props)
    }

    if (!state.hasInitialFetch && typeof window !== 'undefined') {
      storeRef.current?.initialize()
    }
  }, [props.tableName, props.columns, props.pageSize, props.trailingQuery, state.hasInitialFetch])

  return {
    data: state.data,
    count: state.count,
    isSuccess: state.isSuccess,
    isLoading: state.isLoading,
    isFetching: state.isFetching,
    error: state.error,
    hasMore: state.count > state.data.length,
    fetchNextPage: () => storeRef.current?.fetchNextPage(),
    refresh: () => storeRef.current?.initialize(),
  }
}

export {
  useInfiniteQuery,
  type SupabaseQueryHandler,
  type SupabaseTableData,
  type SupabaseTableName,
  type UseInfiniteQueryProps,
}
