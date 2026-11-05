# voice/obsidian_sync.py — Integración Remi Voice ↔ Obsidian
# Lee contexto antes de iniciar, guarda transcripción al terminar

import os
from pathlib import Path
from datetime import datetime

VAULT = os.environ.get("OBSIDIAN_VAULT", str(Path.home() / "Documents/Obsidian/Remi"))


def cargar_contexto() -> str:
    """
    Lee las últimas notas del vault de Obsidian y las inyecta
    al prompt de Remi antes de iniciar el servidor de voz.
    """
    vault = Path(VAULT).expanduser()
    if not vault.exists():
        print(f"⚠️  Vault no encontrado en: {vault}")
        print("   Crea la carpeta o ajusta OBSIDIAN_VAULT en .env")
        return ""

    notas = []

    # Últimas 5 reuniones
    reuniones_dir = vault / "Reuniones"
    if reuniones_dir.exists():
        archivos = sorted(reuniones_dir.glob("*.md"))[-5:]
        for f in archivos:
            try:
                contenido = f.read_text(encoding="utf-8")[:600]
                notas.append(f"[Reunión: {f.stem}]\n{contenido}")
            except Exception:
                pass

    # Métricas actuales
    metricas = vault / "Metricas/resumen.md"
    if metricas.exists():
        try:
            notas.append("[Métricas actuales]\n" + metricas.read_text(encoding="utf-8")[:800])
        except Exception:
            pass

    # Notas de contexto general
    contexto_dir = vault / "Contexto"
    if contexto_dir.exists():
        for f in sorted(contexto_dir.glob("*.md"))[-3:]:
            try:
                notas.append(f"[Contexto: {f.stem}]\n" + f.read_text(encoding="utf-8")[:400])
            except Exception:
                pass

    if not notas:
        return ""

    total = "\n\n---\n".join(notas)
    print(f"📓 Obsidian: {len(notas)} nota(s) cargada(s) ({len(total)} chars)")
    return f"\n\nMEMORIA ACTIVA DE OBSIDIAN:\n{total}"


def guardar_reunion(titulo: str, transcripcion: str) -> Path:
    """
    Guarda la transcripción de la reunión en Obsidian al terminar.
    Retorna la ruta del archivo creado.
    """
    vault = Path(VAULT).expanduser()
    reuniones_dir = vault / "Reuniones"
    reuniones_dir.mkdir(parents=True, exist_ok=True)

    fecha = datetime.now().strftime("%Y-%m-%d_%H-%M")
    nombre_limpio = titulo.replace("/", "-").replace("\\", "-")[:50]
    archivo = reuniones_dir / f"{fecha}-{nombre_limpio}.md"

    contenido = f"""# {titulo}

**Fecha:** {datetime.now().strftime("%Y-%m-%d %H:%M")}
**Participantes:** Equipo + Remi (IA)

## Transcripción

{transcripcion}

---
#reunion #remi #auto-generado
"""
    archivo.write_text(contenido, encoding="utf-8")
    print(f"✅ Reunión guardada en Obsidian: {archivo.name}")
    return archivo


def guardar_nota(titulo: str, contenido: str, carpeta: str = "Notas") -> Path:
    """Guarda una nota arbitraria en el vault."""
    vault = Path(VAULT).expanduser()
    carpeta_path = vault / carpeta
    carpeta_path.mkdir(parents=True, exist_ok=True)

    fecha = datetime.now().strftime("%Y-%m-%d_%H-%M")
    archivo = carpeta_path / f"{fecha}-{titulo[:40]}.md"
    archivo.write_text(f"# {titulo}\n\n{contenido}\n\n#remi", encoding="utf-8")
    return archivo
