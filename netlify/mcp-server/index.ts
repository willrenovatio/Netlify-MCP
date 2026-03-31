import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

export const setupMCPServer = (): McpServer => {
  const server = new McpServer(
    {
      name: "stateless-server",
      version: "1.0.0",
    },
    { capabilities: { logging: {} } }
  );

  server.tool(
    "upload-html",
    "Upload an HTML file to Netlify and return a public access link",
    {
      filename: z.string().describe("File name, e.g. index.html"),
      html_content: z.string().describe("Complete HTML file content"),
    },
    async ({ filename, html_content }): Promise<CallToolResult> => {
      const token = process.env.NETLIFY_ACCESS_TOKEN;
      if (!token) {
        return {
          content: [{ type: "text", text: "Error: NETLIFY_ACCESS_TOKEN not set" }],
        };
      }

      try {
        // Step 1: Create a new site
        const siteRes = await fetch("https://api.netlify.com/api/v1/sites", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: null }),
        });

        if (!siteRes.ok) {
          const err = await siteRes.text();
          return { content: [{ type: "text", text: `Failed to create site: ${err}` }] };
        }

        const site = await siteRes.json();
        const siteId = site.id;

        // Step 2: Calculate file digest (SHA1)
        const encoder = new TextEncoder();
        const data = encoder.encode(html_content);
        const hashBuffer = await crypto.subtle.digest("SHA-1", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const sha1 = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

        // Step 3: Create deploy with file manifest
        const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${siteId}/deploys`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            files: { [`/${filename}`]: sha1 },
          }),
        });

        if (!deployRes.ok) {
          const err = await deployRes.text();
          return { content: [{ type: "text", text: `Failed to create deploy: ${err}` }] };
        }

        const deploy = await deployRes.json();
        const deployId = deploy.id;

        // Step 4: Upload the file
        const uploadRes = await fetch(
          `https://api.netlify.com/api/v1/deploys/${deployId}/files/${filename}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/octet-stream",
            },
            body: html_content,
          }
        );

        if (!uploadRes.ok) {
          const err = await uploadRes.text();
          return { content: [{ type: "text", text: `Failed to upload file: ${err}` }] };
        }

        // Step 5: Return public URL
        const siteUrl = site.ssl_url || site.url;
        const fileUrl = filename === "index.html"
          ? siteUrl
          : `${siteUrl}/${filename}`;

        return {
          content: [{
            type: "text",
            text: `✅ Upload successful!\n\nPublic URL: ${fileUrl}\nSite ID: ${siteId}`,
          }],
        };

      } catch (error) {
        return {
          content: [{ type: "text", text: `Error: ${String(error)}` }],
        };
      }
    }
  );

  return server;
};
