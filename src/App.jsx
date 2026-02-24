import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Box,
  Button,
  Container,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import reactLogo from "./assets/react.svg";

function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function greet() {
    // 使用 Tauri 命令与后端交互，并把返回文案同步到界面状态中
    const message = await invoke("greet", { name });
    setGreetMsg(message);
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        background:
          "radial-gradient(1200px 600px at 10% -10%, #fff2cf 0%, transparent 60%), linear-gradient(135deg, #f4efe2 0%, #edf2fb 45%, #f8f8fc 100%)",
        py: { xs: 4, md: 6 },
        "@keyframes fadeUp": {
          from: { opacity: 0, transform: "translateY(18px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <Container maxWidth="md">
        <Paper
          elevation={0}
          sx={{
            p: { xs: 3, md: 5 },
            borderRadius: 4,
            backgroundColor: "rgba(255, 255, 255, 0.92)",
            boxShadow: "0 20px 60px rgba(30, 50, 80, 0.12)",
            backdropFilter: "blur(6px)",
            animation: "fadeUp 700ms ease-out both",
          }}
        >
          <Stack spacing={4}>
            <Box
              sx={{
                animation: "fadeUp 700ms ease-out both",
                animationDelay: "80ms",
              }}
            >
              <Typography
                variant="overline"
                sx={{ letterSpacing: 3, color: "text.secondary" }}
              >
                PURE PASTER
              </Typography>
              <Typography variant="h3" sx={{ fontWeight: 700, mt: 1 }}>
                Welcome to Tauri + React + MUI
              </Typography>
              <Typography variant="subtitle1" sx={{ color: "text.secondary", mt: 1 }}>
                使用 Material UI 组件重新组织界面，让桌面端原型更易扩展。
              </Typography>
            </Box>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems="center"
              sx={{
                animation: "fadeUp 700ms ease-out both",
                animationDelay: "160ms",
              }}
            >
              <Link href="https://vite.dev" target="_blank" rel="noreferrer" underline="none">
                <Box
                  component="img"
                  src="/vite.svg"
                  alt="Vite logo"
                  sx={{
                    width: 68,
                    height: 68,
                    transition: "transform 200ms ease",
                    "&:hover": { transform: "translateY(-4px)" },
                  }}
                />
              </Link>
              <Link href="https://tauri.app" target="_blank" rel="noreferrer" underline="none">
                <Box
                  component="img"
                  src="/tauri.svg"
                  alt="Tauri logo"
                  sx={{
                    width: 68,
                    height: 68,
                    transition: "transform 200ms ease",
                    "&:hover": { transform: "translateY(-4px)" },
                  }}
                />
              </Link>
              <Link href="https://react.dev" target="_blank" rel="noreferrer" underline="none">
                <Box
                  component="img"
                  src={reactLogo}
                  alt="React logo"
                  sx={{
                    width: 68,
                    height: 68,
                    transition: "transform 200ms ease",
                    "&:hover": { transform: "translateY(-4px)" },
                  }}
                />
              </Link>
            </Stack>

            <Box
              component="form"
              onSubmit={(event) => {
                event.preventDefault();
                greet();
              }}
              sx={{
                animation: "fadeUp 700ms ease-out both",
                animationDelay: "240ms",
              }}
            >
              {/* 使用 MUI 表单组件收集输入，再触发后端问候命令 */}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Name"
                  placeholder="Enter a name..."
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  fullWidth
                />
                <Button type="submit" variant="contained" size="large">
                  Greet
                </Button>
              </Stack>
            </Box>

            <Paper
              variant="outlined"
              sx={{
                p: 2,
                borderRadius: 2,
                backgroundColor: "rgba(248, 249, 252, 0.9)",
                animation: "fadeUp 700ms ease-out both",
                animationDelay: "320ms",
              }}
            >
              {/* 把后端返回的问候内容展示为高对比文本，方便验证联通性 */}
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Latest Greeting
              </Typography>
              <Typography variant="body1" sx={{ color: "text.secondary", mt: 0.5 }}>
                {greetMsg || "等待输入姓名后返回结果。"}
              </Typography>
            </Paper>
          </Stack>
        </Paper>
      </Container>
    </Box>
  );
}

export default App;
