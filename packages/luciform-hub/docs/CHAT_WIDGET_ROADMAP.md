# Chat Widget Integration Roadmap

Integration du chat Lucie avec le backend agent-configurator via Supabase Realtime.

## URLs

| Service | URL |
|---------|-----|
| Backend API | `https://lucie-agent.luciformresearch.com` |
| Supabase | `https://supabase.luciformresearch.com` |
| Anon Key | `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH` |

## Roadmap

### Phase 1: Configuration Supabase Client

- [ ] Installer `@supabase/supabase-js`
- [ ] Créer `lib/supabase.ts` avec URL publique
- [ ] Configurer le client avec l'anon key

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  'https://supabase.luciformresearch.com',
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
)
```

### Phase 2: Adapter ChatWidget.tsx

- [ ] Remplacer appel `/api/chat` par appel direct à l'API publique
- [ ] Utiliser Supabase Realtime pour les updates (comme agent-configurator frontend)
- [ ] Persister `conversation_id` en localStorage pour reprendre une conversation
- [ ] Ajouter endpoint pour récupérer historique d'un visitor

**API Endpoints:**
```
POST /api/public/agents/lucie/chat
  Body: { message, visitor_id?, conversation_id? }
  Returns: { message_id, conversation_id, status }

GET /api/public/conversations/{id}/messages
  Returns: [{ id, role, content, status, created_at }]
```

**Realtime subscription:**
```typescript
supabase
  .channel(`conversation:${conversationId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${conversationId}`,
  }, (payload) => {
    // Handle INSERT (new message) or UPDATE (streaming content)
  })
  .subscribe()
```

### Phase 3: UI Améliorations

- [ ] **Bouton expand** (flèche diagonale) pour ouvrir en grand
- [ ] Mode expanded: plein écran ou panel latéral plus large
- [ ] Transition smooth entre les deux modes
- [ ] Raccourci clavier (Escape pour fermer)

### Phase 4: Google OAuth (Optionnel)

Permettre la connexion Google pour:
- Identifier les utilisateurs de manière fiable (pas juste visitor_id)
- **Whitelister des comptes** (ex: admin depuis mobile)
- Historique de conversations persistant par compte

**Flow:**
1. Bouton "Se connecter avec Google" dans le widget
2. OAuth via `supabase.auth.signInWithOAuth({ provider: 'google' })`
3. Callback vers `https://luciformresearch.com/auth/callback`
4. Stocker session, associer conversations au user

**Whitelist par email:**
```python
# backend/app/middleware/rate_limit.py
WHITELISTED_EMAILS = ["lucie@luciformresearch.com"]

def _is_whitelisted(self, request: Request) -> bool:
    # Check email from auth header/session
    email = get_user_email_from_request(request)
    if email and email in WHITELISTED_EMAILS:
        return True
    # ... existing IP/visitor_id checks
```

### Phase 5: Supprimer l'ancienne API

- [ ] Supprimer `app/api/chat/route.ts` (proxy vers ancien backend)
- [ ] Nettoyer les dépendances inutiles

## Fichiers à modifier

| Fichier | Action |
|---------|--------|
| `package.json` | Ajouter `@supabase/supabase-js` |
| `lib/supabase.ts` | Créer - client Supabase |
| `app/components/ChatWidget.tsx` | Adapter - API + Realtime |
| `app/api/chat/route.ts` | Supprimer (Phase 5) |
| `app/auth/callback/page.tsx` | Créer si OAuth (Phase 4) |

## Rate Limiting

- 5 requêtes/heure
- 20 requêtes/jour
- Par visitor_id ET IP (les deux comptent)
- Whitelist par IP ou email (si connecté)

## Notes

- Le streaming se fait via Supabase Realtime (postgres_changes)
- Pas de SSE direct depuis le backend
- Les messages ont un `status`: pending → processing → streaming → completed
