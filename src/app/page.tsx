
'use client';

import React, { useEffect, useState, useMemo, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Bot, Cog, FileText, Info, Loader2, Search, Send, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SidebarProvider, Sidebar, SidebarHeader, SidebarContent, SidebarInset, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from '@/components/ui/sidebar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { handleSearch, type SearchState } from './actions';
import type { SearchDocumentsOutput } from '@/ai/flows/search-documents';
import { Textarea } from '@/components/ui/textarea';

type DBSettings = {
  uri: string;
  dbName: string;
};

function DigitaliusLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2Z"
        fill="currentColor"
        className="text-sidebar-primary"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 5.5C8.96243 5.5 6.5 7.96243 6.5 11V13C6.5 15.0376 8.96243 18.5 12 18.5C15.0376 18.5 17.5 16.0376 17.5 13V11C17.5 7.96243 15.0376 5.5 12 5.5ZM12 8.5C13.3807 8.5 14.5 9.61929 14.5 11V13C14.5 14.3807 13.3807 15.5 12 15.5C10.6193 15.5 9.5 14.3807 9.5 13V11C9.5 9.61929 10.6193 8.5 12 8.5Z"
        fill="hsl(var(--sidebar-background))"
      />
    </svg>
  );
}


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
        const processLine = (line: string): (string | JSX.Element)[] => {
            const regex = /(\*\*(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(.*?))\*\*)|\[(.*?)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s.,!?\)";:'`]+)/g;
            let lastIndex = 0;
            const results: (string | JSX.Element)[] = [];
            let match;

            while ((match = regex.exec(line)) !== null) {
                if (match.index > lastIndex) {
                    results.push(line.substring(lastIndex, match.index));
                }

                const [
                    fullMatch,
                    boldContent,
                    boldLinkText,
                    boldLinkUrl,
                    boldText,
                    linkText,
                    linkUrl,
                    standaloneUrl,
                ] = match;
                
                if (boldLinkText && boldLinkUrl) {
                    results.push(
                        <strong key={lastIndex}>
                            <a
                                href={boldLinkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent underline hover:text-accent/80"
                            >
                                {boldLinkText}
                            </a>
                        </strong>
                    );
                } else if (boldText) {
                    results.push(<strong key={lastIndex}>{boldText}</strong>);
                } else if (linkText && linkUrl) {
                    results.push(
                        <a
                            key={lastIndex}
                            href={linkUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline hover:text-accent/80"
                        >
                            {linkText}
                        </a>
                    );
                } else if (standaloneUrl) {
                     results.push(
                        <a
                            key={lastIndex}
                            href={standaloneUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent underline hover:text-accent/80"
                        >
                            {standaloneUrl}
                        </a>
                    );
                } else {
                    results.push(fullMatch);
                }
                
                lastIndex = regex.lastIndex;
            }

            if (lastIndex < line.length) {
                results.push(line.substring(lastIndex));
            }

            return results;
        };

        const lines = answer.split('\n');
        const elements: (JSX.Element | null)[] = [];
        let listItems: string[] = [];
        let listKey = 0;

        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('* ') || trimmedLine.startsWith('- ')) {
                listItems.push(trimmedLine.substring(2));
            } else {
                if (listItems.length > 0) {
                    elements.push(
                        <ul key={`ul-${listKey++}`} className="list-disc pl-5 mb-4 space-y-2">
                            {listItems.map((item, itemIndex) => (
                                <li key={itemIndex}>{processLine(item)}</li>
                            ))}
                        </ul>
                    );
                    listItems = [];
                }
                if (trimmedLine) {
                    elements.push(
                        <p key={`p-${index}`} className="mb-4 last:mb-0">
                            {processLine(trimmedLine)}
                        </p>
                    );
                }
            }
        });

        if (listItems.length > 0) {
            elements.push(
                <ul key="ul-last" className="list-disc pl-5 mb-4 space-y-2">
                    {listItems.map((item, itemIndex) => (
                        <li key={itemIndex}>{processLine(item)}</li>
                    ))}
                </ul>
            );
        }

        return elements.filter(Boolean);

    }, [answer]);

    return (
        <Card className="bg-secondary/50">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Bot className="text-primary" />
                    Respuesta de la IA
                </CardTitle>
            </CardHeader>
            <CardContent className="text-base leading-relaxed prose prose-sm max-w-none prose-p:mb-4 prose-ul:mb-4">
                {formattedAnswer}
            </CardContent>
        </Card>
    );
});

function SearchResults({ results }: { results: SearchDocumentsOutput['results'] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {results.map((item) => {
        let title = 'Documento sin Título';
        let description = item.titulo || item.titulo_seccion || '';

        // Check for 'numero' to identify circulares and instructivos
        if (item.numero) {
            // Heuristic to differentiate: circulares might have '/' in numero
            if (String(item.numero).includes('/')) {
                 title = `Circular ${item.numero}`;
            } else {
                 title = `Instructivo ${item.numero}`;
            }
        } else if (item.articulos && item.articulos.length > 0 && item.articulos[0].numero_articulo) {
          title = `Artículo ${item.articulos[0].numero_articulo}`;
        } else if (item.titulo) {
           title = item.titulo;
        }

        // The description can be used for the regulation or as a fallback
        if (title.startsWith('Artículo')) {
            description = 'Reglamento de Expediente Digital';
        } else if (item.titulo && title !== item.titulo) {
            description = item.titulo;
        }


        return (
          <Card key={item._id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-lg">{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent className="flex-grow">
              <p className="text-muted-foreground mb-4">{item.resumen || (item.articulos && item.articulos[0]?.resumen_articulo) || 'No hay resumen disponible.'}</p>
              <div className="flex flex-wrap gap-2">
                {(item.palabras_clave || []).concat(item.articulos?.flatMap(a => a.palabras_clave_articulo || []) || []).map((keyword, index) => (
                  <Badge key={`${keyword}-${index}`} variant="secondary">{keyword}</Badge>
                ))}
              </div>
            </CardContent>
            <div className="p-6 pt-0">
               {item.link_de_acceso && (
                <Button asChild variant="link" className="p-0 h-auto">
                  <a href={item.link_de_acceso} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                    Ver Documento <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  const [dbSettings, setDbSettings] = useState<DBSettings>({ 
    uri: process.env.MONGODB_URI || '', 
    dbName: process.env.MONGODB_DATABASE_NAME || '' 
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const initialState: SearchState = {};
  const [state, formAction] = useActionState(handleSearch, initialState);
  const { toast } = useToast();
  const { pending } = useFormStatus();
  const formRef = React.useRef<HTMLFormElement>(null);

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('digitaliusDbSettings');
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        if (parsedSettings.uri && parsedSettings.dbName) {
            setDbSettings(parsedSettings);
        }
      }
    } catch (error) {
      console.error('No se pudo cargar la configuración desde localStorage', error);
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
      localStorage.setItem('digitaliusDbSettings', JSON.stringify(settings));
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      (event.target as HTMLTextAreaElement).value.trim() !== ''
    ) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  };


  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-2 p-2">
              <DigitaliusLogo className="h-8 w-8 text-sidebar-primary" />
              <h1 className="text-xl font-semibold text-sidebar-foreground">Digitalius</h1>
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
                    <CardDescription>Introduce tu consulta para buscar en todos los documentos.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <input type="hidden" name="mongodbUri" value={dbSettings.uri} />
                    <input type="hidden" name="mongodbDatabaseName" value={dbSettings.dbName} />

                    <div>
                      <Label htmlFor="query">Tu Consulta</Label>
                      <Textarea
                        id="query"
                        name="query"
                        placeholder="ej., '¿Cuáles son las reglas para las firmas digitales?' o '¿Cuántas circulares hay sobre expedientes digitales?'"
                        className="mt-1 min-h-[100px]"
                        required
                        onKeyDown={handleKeyDown}
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
                  <h3 className="text-xl font-semibold">Bienvenido a Digitalius</h3>
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
