import { useState } from 'react';
import { Provider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { createApi } from './api/client';
import { createAssistantStore } from './state/store';
import { theme } from './theme';
import { Chat } from './components/Chat';
import './styles.css';

export interface AssistantWidgetProps {
  mode?: 'demo' | 'live';
  apiBaseUrl?: string;
  initiallyOpen?: boolean;
}

export default function AssistantWidget({
  mode,
  apiBaseUrl,
  initiallyOpen = false,
}: AssistantWidgetProps) {
  const [store] = useState(createAssistantStore);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );
  const [api] = useState(() => createApi({ mode, baseUrl: apiBaseUrl }));
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <Chat api={api} initiallyOpen={initiallyOpen} />
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  );
}
