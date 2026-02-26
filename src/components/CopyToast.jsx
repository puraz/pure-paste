import { Alert, Snackbar } from "@mui/material";

// 复制成功提示：把 Snackbar UI 抽离出来，避免主视图出现过多“非核心布局”代码。

export const CopyToast = ({ open, onClose }) => (
  <Snackbar
    open={open}
    autoHideDuration={1400}
    onClose={onClose}
    anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
  >
    <Alert severity="success" variant="filled" onClose={onClose} sx={{ width: "100%" }}>
      复制成功
    </Alert>
  </Snackbar>
);

