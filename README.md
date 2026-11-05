# Remi: agente operativo de IA para CRM

Remi es un agente de IA que automatiza operaciones de un CRM basado en **GoHighLevel**: gestiona contactos, pipelines, oportunidades y workflows, envía mensajes, hace seguimiento de ventas y avisa al equipo por Slack. También puede hablar por voz con ElevenLabs.

> Proyecto personal. Esta versión está sanitizada para portafolio: no lleva claves, IDs reales ni datos de clientes. Toda la configuración sensible se carga desde variables de entorno.

## Arquitectura

```
src/           Servidor principal: agente, herramientas, tareas programadas, WhatsApp, Slack, Sheets, Notion
mcp/           Servidores MCP
  ghl/         GoHighLevel: contactos, pipelines, automatizaciones en lenguaje natural
  gdrive/      Google Drive
  meta/        Meta Ads
  vault/       Base de conocimiento en Markdown
  whatsapp/    Mensajería
webhook/       Receptor de eventos entrantes
voice/         Voz con ElevenLabs y la persona del agente
public/        Panel de administración web
remi-daemon/   Proceso en segundo plano
dealer/        Reparto y asignación de leads
config/        Plantillas de configuración MCP por equipo
memory/        Definición de agentes, herramientas y tareas programadas
```

## Stack

| Área        | Tecnología                                   |
|-------------|----------------------------------------------|
| Backend     | Node.js, Python                              |
| Integración | APIs REST, webhooks, MCP (Model Context Protocol) |
| Servicios   | GoHighLevel, Slack, Google Workspace, Meta Ads, Notion, ElevenLabs |
| Despliegue  | Docker, Railway                              |

## Cómo ejecutarlo

Requisito: Node.js 18 o superior.

```bash
npm install
cp .env.example .env   # rellena tus propias claves
npm start
```

Con Docker:

```bash
docker build -t remi .
docker run --env-file .env -p 3000:3000 remi
```

Todas las variables necesarias (token de GoHighLevel, Location ID, Slack, ElevenLabs, etc.) están documentadas en `.env.example`. No subas nunca el archivo `.env`.

## Autora

Julieth Sánchez · [github.com/julisan12](https://github.com/julisan12)
