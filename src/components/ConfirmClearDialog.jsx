import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from "@mui/material";

// 清空操作确认弹窗：把弹窗 UI 从主视图中抽离出来，让主视图更聚焦于布局与交互。
// 目前只有“清空历史”一个动作，未来若增加更多类型的清空，可在这里扩展文案与确认逻辑。

export const ConfirmClearDialog = ({ open, onCancel, onConfirm, onExited }) => (
  <Dialog open={open} onClose={onCancel} TransitionProps={{ onExited }}>
    <DialogTitle>确认清空</DialogTitle>
    <DialogContent>
      <DialogContentText>确定要清空全部历史记录吗？此操作不可撤销。</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button variant="outlined" onClick={onCancel}>
        取消
      </Button>
      <Button variant="contained" color="secondary" onClick={onConfirm}>
        确认清空
      </Button>
    </DialogActions>
  </Dialog>
);

