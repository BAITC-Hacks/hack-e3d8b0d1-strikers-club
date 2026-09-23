import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    primary: { main: '#1b61db', dark: '#174ab0' },
    text: { primary: '#172b4b', secondary: '#7b879b' },
    background: { default: '#f3f5f8', paper: '#ffffff' },
    success: { main: '#258969' },
    divider: '#e9edf3',
  },
  typography: {
    fontFamily: '"Inter", "Segoe UI", Arial, sans-serif',
    button: { textTransform: 'none', fontWeight: 600, fontSize: 13 },
    h6: { fontWeight: 650, fontSize: 18 },
  },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 10 } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 20 } } },
    MuiTooltip: { defaultProps: { arrow: true } },
  },
});
