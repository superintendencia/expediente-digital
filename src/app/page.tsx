
'use client';

import React, { useEffect, useState, useMemo, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Bot, Cog, FileText, Info, Loader2, Search, Send, FileArchive, BookCopy, FileBadge, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { handleSearch, type SearchState } from './actions';
import type { SearchDocumentsOutput } from '@/ai/flows/search-documents';

type DBSettings = {
  uri: string;
  dbName: string;
};

const documentTypes = [
  { value: 'circular', label: 'Circulares', icon: FileBadge },
  { value: 'instruction', label: 'Instructivos', icon: FileArchive },
  { value: 'regulation', label: 'Reglamentos', icon: BookCopy },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full md:w-auto">
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
      Buscar
    </Button>
  );
}

function SettingsDialog({
  isOpen,
  onOpenChange,
  onSave,
  initialSettings,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSave: (settings: DBSettings) => void;
  initialSettings: DBSettings;
}) {
  const [settings, setSettings] = useState<DBSettings>(initialSettings);

  useEffect(() => {
    setSettings(initialSettings);
  }, [initialSettings]);

  const handleSaveClick = () => {
    onSave(settings);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Configuración de la Base de Datos</DialogTitle>
          <DialogDescription>
            Introduce los detalles de conexión de tu MongoDB Atlas. Se guardarán localmente en tu navegador.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="mongodb-uri" className="text-right">
              URI de MongoDB
            </Label>
            <Input
              id="mongodb-uri"
              value={settings.uri}
              onChange={(e) => setSettings({ ...settings, uri: e.target.value })}
              className="col-span-3"
              placeholder="mongodb+srv://..."
            />
          </div>
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="db-name" className="text-right">
              Nombre de la BD
            </Label>
            <Input
              id="db-name"
              value={settings.dbName}
              onChange={(e) => setSettings({ ...settings, dbName: e.target.value })}
              className="col-span-3"
              placeholder="asistentes-expediente-digital"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSaveClick}>Guardar Cambios</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const MemoizedAIAnswer = React.memo(function AIAnswer({ answer }: { answer: string }) {
  const formattedAnswer = useMemo(() => {
    return answer
      .split('\n')
      .map((paragraph, index) => {
        if (paragraph.trim() === '') return null;
        const urlRegex = /(https?:\/\/[^\s)]+)/g;
        const parts = paragraph.split(urlRegex);
        return (
          <p key={index} className="mb-4 last:mb-0">
            {parts.map((part, i) => {
              if (urlRegex.test(part)) {
                let cleanUrl = part;
                // Remove trailing punctuation that might be caught by the regex
                const trailingChars = /[.,!?)";:'`]*$/;
                cleanUrl = part.replace(trailingChars, '');
                const punctuation = part.substring(cleanUrl.length);

                return (
                  <React.Fragment key={i}>
                    <a
                      href={cleanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent underline hover:text-accent/80"
                    >
                      {cleanUrl}
                    </a>
                    {punctuation}
                  </React.Fragment>
                );
              }
              return part;
            })}
          </p>
        );
      })
      .filter(Boolean);
  }, [answer]);

  return (
    <Card className="bg-secondary/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="text-primary" />
          Respuesta de la IA
        </CardTitle>
      </CardHeader>
      <CardContent className="text-base leading-relaxed">{formattedAnswer}</CardContent>
    </Card>
  );
});

function SearchResults({ results }: { results: SearchDocumentsOutput['results'] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {results.map((item) => (
        <Card key={item._id} className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">{item.titulo || item.titulo_seccion || 'Documento sin Título'}</CardTitle>
            <CardDescription>{item.tipo_normativa ? `${item.tipo_normativa} #${item.numero}` : 'Sección del Reglamento'}</CardDescription>
          </CardHeader>
          <CardContent className="flex-grow">
            <p className="text-muted-foreground mb-4">{item.resumen || (item.articulos && item.articulos[0]?.resumen_articulo) || 'No hay resumen disponible.'}</p>
            <div className="flex flex-wrap gap-2">
              {(item.palabras_clave || []).map((keyword) => (
                <Badge key={keyword} variant="secondary">{keyword}</Badge>
              ))}
            </div>
          </CardContent>
          <div className="p-6 pt-0">
             {item.link_acceso && (
              <Button asChild variant="link" className="p-0 h-auto">
                <a href={item.link_acceso} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                  Ver Documento <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

export default function HomePage() {
  const [dbSettings, setDbSettings] = useState<DBSettings>({ uri: '', dbName: '' });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const initialState: SearchState = {};
  const [state, formAction] = useActionState(handleSearch, initialState);
  const { toast } = useToast();
  const { pending } = useFormStatus();

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('lexiAssistDbSettings');
      if (savedSettings) {
        setDbSettings(JSON.parse(savedSettings));
      } else {
        setIsSettingsOpen(true);
      }
    } catch (error) {
      console.error('No se pudo cargar la configuración desde localStorage', error);
      setIsSettingsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (state.error) {
      toast({
        variant: 'destructive',
        title: 'Ocurrió un error',
        description: state.error,
      });
    }
  }, [state.error, toast]);

  const handleSaveSettings = (settings: DBSettings) => {
    setDbSettings(settings);
    try {
      localStorage.setItem('lexiAssistDbSettings', JSON.stringify(settings));
      toast({
        title: 'Configuración Guardada',
        description: 'La configuración de tu base de datos ha sido guardada localmente.',
      });
    } catch (error) {
      console.error('No se pudo guardar la configuración en localStorage', error);
      toast({
        variant: 'destructive',
        title: 'Error al guardar la configuración',
        description: 'No se pudo guardar la configuración en el almacenamiento local de tu navegador.',
      });
    }
  };

  const formRef = React.useRef<HTMLFormElement>(null);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2 p-2">
              <Bot className="h-8 w-8 text-sidebar-primary" />
              <h1 className="text-xl font-semibold text-sidebar-foreground">LexiAssist</h1>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton isActive>
                  <Search />
                  <span>Buscar</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarContent>
        </Sidebar>

        <SidebarInset className="flex flex-col">
          <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/80 px-4 backdrop-blur-sm sm:px-6">
            <h2 className="text-xl font-semibold">Búsqueda Inteligente de Documentos</h2>
            <Button variant="ghost" size="icon" onClick={() => setIsSettingsOpen(true)}>
              <Cog />
              <span className="sr-only">Configuración</span>
            </Button>
          </header>

          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="mx-auto max-w-5xl">
              <form ref={formRef} action={formAction} className="mb-8">
                <Card>
                  <CardHeader>
                    <CardTitle>Nueva Consulta</CardTitle>
                    <CardDescription>Selecciona un tipo de documento e introduce tu consulta para buscar.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <input type="hidden" name="mongodbUri" value={dbSettings.uri} />
                    <input type="hidden" name="mongodbDatabaseName" value={dbSettings.dbName} />

                    <div>
                      <Label htmlFor="documentType">Tipo de Documento</Label>
                      <Select name="documentType" defaultValue="circular" required>
                        <SelectTrigger id="documentType" className="mt-1">
                          <SelectValue placeholder="Selecciona un tipo de documento" />
                        </SelectTrigger>
                        <SelectContent>
                          {documentTypes.map(({ value, label, icon: Icon }) => (
                            <SelectItem key={value} value={value}>
                              <div className="flex items-center gap-2">
                                <Icon className="h-4 w-4 text-muted-foreground" />
                                <span>{label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {state.formErrors?.documentType && <p className="text-sm font-medium text-destructive mt-1">{state.formErrors.documentType[0]}</p>}
                    </div>

                    <div>
                      <Label htmlFor="query">Tu Consulta</Label>
                      <Textarea
                        id="query"
                        name="query"
                        placeholder="ej., '¿Cuáles son las reglas para las firmas digitales?'"
                        className="mt-1 min-h-[100px]"
                        required
                      />
                      {state.formErrors?.query && <p className="text-sm font-medium text-destructive mt-1">{state.formErrors.query[0]}</p>}
                    </div>
                    
                    <div className="flex justify-end">
                      <SubmitButton />
                    </div>
                  </CardContent>
                </Card>
              </form>

              {pending && (
                <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
                  <Loader2 className="h-12 w-12 animate-spin text-primary" />
                  <p className="text-muted-foreground">Buscando documentos y generando respuesta...</p>
                </div>
              )}

              {!pending && !state.data && (
                <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
                  <Bot className="h-16 w-16 text-muted-foreground/50" />
                  <h3 className="text-xl font-semibold">Bienvenido a LexiAssist</h3>
                  <p className="text-muted-foreground">Tu asistente de documentos con IA. <br />Comienza introduciendo una consulta arriba.</p>
                </div>
              )}
              
              {!pending && state.data && (
                <Tabs defaultValue="answer" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="answer"><Bot className="mr-2 h-4 w-4" />Respuesta de la IA</TabsTrigger>
                    <TabsTrigger value="documents"><FileText className="mr-2 h-4 w-4" />Documentos Fuente</TabsTrigger>
                  </TabsList>
                  <TabsContent value="answer" className="mt-4">
                    <MemoizedAIAnswer answer={state.data.answer} />
                  </TabsContent>
                  <TabsContent value="documents" className="mt-4">
                    {state.data.results && state.data.results.length > 0 ? (
                      <SearchResults results={state.data.results} />
                    ) : (
                      <Card className="flex flex-col items-center justify-center p-8">
                        <Info className="h-12 w-12 text-muted-foreground/50" />
                        <h3 className="mt-4 text-xl font-semibold">No se Encontraron Documentos</h3>
                        <p className="text-muted-foreground mt-1">Tu consulta no coincidió con ningún documento.</p>
                      </Card>
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </div>
          </main>
        </SidebarInset>
      </div>
      <SettingsDialog
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        onSave={handleSaveSettings}
        initialSettings={dbSettings}
      />
    </SidebarProvider>
  );
}
