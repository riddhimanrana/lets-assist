'use client'

import { createClient } from '@/lib/supabase/client'
import { PostgrestQueryBuilder, type PostgrestClientOptions } from '@supabase/postgrest-js'
import { type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useSyncExternalStore, useCallback } from 'react'

// The following types are used to make the hook type-safe. It extracts the database type from the supabase client.
// Create a temporary client just for type inference
const typeClient = createClient()
type SupabaseClientType = typeof typeClient

// Utility type to check if the type is any
type IfAny<T, Y, N> = 0 extends 1 & T ? Y : N
type Database =
  SupabaseClientType extends SupabaseClient<infer U>
    ? IfAny<
        U,
        {
          public: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Tables: Record<string, any>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Views: Record<string, any>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            Functions: Record<string, any>
          }
        },
        U
      >
    : {
        public: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Tables: Record<string, any>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Views: Record<string, any>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Functions: Record<string, any>
        }
      }

type DatabaseSchema = Database['public']
type SupabaseTableName = keyof DatabaseSchema['Tables']
type SupabaseTableData<T extends SupabaseTableName> = DatabaseSchema['Tables'][T]['Row']
type DefaultClientOptions = PostgrestClientOptions

type SupabaseSelectBuilder<T extends SupabaseTableName> = ReturnType<
  PostgrestQueryBuilder<
    DefaultClientOptions,
    DatabaseSchema,
    DatabaseSchema['Tables'][T],
    T
  >['select']
>

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
  // Whether the query is enabled, defaults to true
  enabled?: boolean
  // Optional Supabase client to use (for shared auth state)
  client?: SupabaseClientType
}

interface StoreState<TData, T extends SupabaseTableName> {
  data: TData[]
  count: number
  isSuccess: boolean
  isLoading: boolean
  isFetching: boolean
  error: Error | null
  hasInitialFetch: boolean
  // Store these to compare for updates
  tableName: string
  columns: string
  pageSize: number
  trailingQuery?: SupabaseQueryHandler<T>
  enabled: boolean
}

type Listener = () => void

function createStore<TData extends SupabaseTableData<T>, T extends SupabaseTableName>(
  props: UseInfiniteQueryProps<T>
) {
  const { tableName, columns = '*', pageSize = 20, trailingQuery, enabled = true, client } = props
  
  // Use passed client or create a fresh one for this store instance
  const supabase = client || createClient()

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
    enabled,
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
    if (!state.enabled || (state.hasInitialFetch && (state.isFetching || state.count <= state.data.length))) return

    setState({ isFetching: true })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = supabase
      .from(tableName)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select(columns, { count: 'exact' }) as unknown as SupabaseSelectBuilder<T>

      if (state.trailingQuery) {
        query = state.trailingQuery(query)
      }
      const { data: newData, count, error } = await query.range(skip, skip + state.pageSize - 1)

      console.log(`[useInfiniteQuery] Fetched ${state.tableName}:`, { 
        skip, 
        count, 
        dataLength: newData?.length, 
        error 
      });

      if (error) {
      console.error('An unexpected error occurred:', error)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setState({ error: error as any })
    } else {
      setState({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: [...state.data, ...(newData as TData[])],
        count: count || 0,
        isSuccess: true,
        error: null,
      })
    }
    setState({ isFetching: false })
  }

  const fetchNextPage = async () => {
    if (state.isFetching || !state.enabled) return
    await fetchPage(state.data.length)
  }

  const initialize = async (force: boolean = false) => {
    if (!state.enabled || (state.isLoading && !force)) return
    if (state.hasInitialFetch && !force) return
    
    setState({ isLoading: true, isSuccess: false, data: force ? [] : state.data })
    try {
      await fetchPage(0)
    } finally {
      setState({ isLoading: false, hasInitialFetch: true })
    }
  }

  const updateProps = (newProps: UseInfiniteQueryProps<T>) => {
    const { tableName, columns, pageSize, trailingQuery, enabled } = newProps
    
    // Check if critical props changed requiring a reset
    const shouldReset = 
      tableName !== state.tableName ||
      columns !== state.columns ||
      trailingQuery !== state.trailingQuery

    console.log('[useInfiniteQuery] updateProps:', { shouldReset, newEnabled: enabled, currentEnabled: state.enabled });

    if (shouldReset) {
      state = {
        ...state,
        tableName,
        columns: columns || '*',
        pageSize: pageSize || 20,
        trailingQuery,
        enabled: enabled ?? true,
        data: [],
        count: 0,
        hasInitialFetch: false,
        isLoading: false,
        isFetching: false,
        error: null
      }
      notify()
      if (state.enabled) {
        initialize()
      }
    } else {
      // Check if other props actually changed
      const newPageSize = pageSize || 20
      const newEnabled = enabled ?? true
      
      if (newPageSize === state.pageSize && newEnabled === state.enabled) {
        return // No changes, do nothing
      }

      // Just update other props
      state = {
        ...state,
        pageSize: newPageSize,
        enabled: newEnabled
      }
      notify()
      
      // If enabled changed from false to true, initialize
      if (state.enabled && !state.hasInitialFetch && !state.isLoading) {
        initialize()
      }
    }
  }

  return {
    getState: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    fetchNextPage,
    initialize,
    updateProps,
  }
}

// Global initial state to avoid hydration mismatch
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const initialState: any = {
  data: [],
  count: 0,
  isSuccess: false,
  isLoading: false,
  isFetching: false,
  error: null,
  hasInitialFetch: false,
}

function useInfiniteQuery<
  TData extends SupabaseTableData<T>,
  T extends SupabaseTableName = SupabaseTableName,
>(props: UseInfiniteQueryProps<T>) {
  // Use a ref to hold the store, created once
  const storeRef = useRef<ReturnType<typeof createStore<TData, T>> | null>(null)

  if (!storeRef.current) {
    storeRef.current = createStore<TData, T>(props)
  }

  const state = useSyncExternalStore(
    storeRef.current.subscribe,
    () => storeRef.current!.getState(),
    () => initialState as StoreState<TData, T>
  )

  // Update store props when they change
  useEffect(() => {
    console.log('[useInfiniteQuery] useEffect dependency change detected:', {
      tableName: props.tableName,
      columns: props.columns,
      pageSize: props.pageSize,
      trailingQueryChanged: props.trailingQuery !== storeRef.current?.getState().trailingQuery,
      enabled: props.enabled
    });
    storeRef.current?.updateProps(props)
  }, [props.tableName, props.columns, props.pageSize, props.trailingQuery, props.enabled])

  // Initial fetch effect - only runs once on mount if enabled
  useEffect(() => {
    if (props.enabled !== false && !storeRef.current?.getState().hasInitialFetch) {
      storeRef.current?.initialize()
    }
  }, []) // Empty dependency array to run only on mount

  // Stable callbacks
  const fetchNextPage = useCallback(() => {
    storeRef.current?.fetchNextPage()
  }, [])

  const refresh = useCallback(() => {
    storeRef.current?.initialize(true)
  }, [])

  return {
    data: state.data,
    count: state.count,
    isSuccess: state.isSuccess,
    isLoading: state.isLoading,
    isFetching: state.isFetching,
    error: state.error,
    hasMore: state.hasInitialFetch ? state.data.length < state.count : true,
    fetchNextPage,
    refresh,
  }
}

export {
  useInfiniteQuery,
  type SupabaseQueryHandler,
  type SupabaseTableData,
  type SupabaseTableName,
  type UseInfiniteQueryProps,
}
