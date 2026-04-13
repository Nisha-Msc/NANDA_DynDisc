@echo off
cd /d "C:\nisha\chainaim\mcpserver\chainaim3003\DynDisc_NANDA\DynDisc_mcp\DynDiscNEST\A2A\js"
if not exist node_modules (
    npm install --legacy-peer-deps 1>&2
)
npx tsx src\mcp\server-sse.ts
