import * as vscode from 'vscode';
import { readFile, readdir, writeFile } from 'fs/promises';
import { dirname, join as pathJoin, resolve, parse as pathParse } from 'path';
import { customVisitorFactory, DuplicateIdentifierException, CallDNEException, ArgCountMismatchException, RefArgMismatchException, ReservedException, IdentDNEException, HangingIdentifierException } from './language/customVisitorFactory';
import { RivalsAIParser } from './language/parser';
import { ICstVisitor, ILexingError, IRecognitionException, isRecognitionException, MismatchedTokenException } from 'chevrotain';
import { loadBuiltins } from './language/getIncludeData';
import { RivalsAILexer } from './language/tokens';
import { IDefined, IFuncDef, IIdentifier, IScript } from './language/definitions';
import { generateStruct } from './language/generateStruct';

export class CacheManager implements vscode.Disposable, vscode.CompletionItemProvider<vscode.CompletionItem>, vscode.DefinitionProvider {

  private parser: RivalsAIParser;
  private BaseRivalsAIVisitorClass: new (...args: any[]) => ICstVisitor<any, any>;
  private VisitorClass?: ReturnType<typeof customVisitorFactory>;
  private visitorInstance?: InstanceType<ReturnType<typeof customVisitorFactory>>;
  private completionItems: IIdentifier[] = [];

  private currDir?: string;

  private diagnosticsCollection: vscode.DiagnosticCollection;
  private disposables: vscode.Disposable[] = [];

  private docChangeTimer?: ReturnType<typeof setInterval>;

  constructor() {
    this.parser = new RivalsAIParser();
    this.BaseRivalsAIVisitorClass = this.parser.getBaseCstVisitorConstructor();

    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((textDoc) => this.handleDocOpen(textDoc)),
      vscode.workspace.onDidSaveTextDocument((textDoc) => this.handleDocSave(textDoc)),
      vscode.workspace.onDidChangeTextDocument((changeEvt) => this.handleDocChange(changeEvt.document)),
      vscode.window.onDidChangeTextEditorSelection((changeEvt) => { if (changeEvt.kind == vscode.TextEditorSelectionChangeKind.Mouse) { this.handleDocSave(changeEvt.textEditor.document) } }),
      vscode.workspace.onDidChangeConfiguration((config) => this.handleConfigChange(config)),
      (this.diagnosticsCollection = vscode.languages.createDiagnosticCollection("rai")),
      vscode.languages.registerCompletionItemProvider({scheme: "file", language: "rai"}, this),
      vscode.languages.registerDefinitionProvider({scheme: "file", language: "rai"}, this),
      vscode.commands.registerCommand("rai.compile", () => this.compileAndExport()),
    );
  }

  public provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.LocationLink[]> {
    if (!this.completionItems.length) return [];

    const wordRange = document.getWordRangeAtPosition(position);
    const word = document.getText(wordRange);

    let idx = -1;
    if ((idx = this.completionItems.map(item => item.name).indexOf(word)) == -1) return [];

    const out = new vscode.Location(
      vscode.Uri.file(this.completionItems[idx].file.name), 
      new vscode.Position(
        this.completionItems[idx].location.startLine - 1,
        this.completionItems[idx].location.startColumn! - 1
      )
    );

    return out;
  }

  public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList<vscode.CompletionItem>> {
    if (!this.completionItems.length) return [];
    
    const out: vscode.CompletionItem[] = [];
    const items = this.completionItems;
    for (const item of items) {
      out.push({
        label: item.name,
        kind: (() => {
          switch(item.idKind) {
            default: return undefined;
            case 'arg': return vscode.CompletionItemKind.Reference;
            case 'funcDef': return vscode.CompletionItemKind.Function;
            case 'scriptDef': return vscode.CompletionItemKind.Interface;
            case 'global':
            case 'variable': return vscode.CompletionItemKind.Variable;
            case 'define': return vscode.CompletionItemKind.Constant;
          }
        })(),
        documentation: (() => {
          switch(item.idKind) {
            default: return undefined;
            case 'scriptDef': return (item as IScript).arguments.map(arg => arg.name).join(", ");
            case 'funcDef': return (item as IFuncDef).arguments.map(arg => arg.name).join(", ");
            case 'define': return (item as IDefined).text;
          }
        })(),
        insertText: (() => {
          switch(item.idKind) {
            default: return undefined;
            case 'scriptDef': return new vscode.SnippetString(item.name + "(" + (item as IScript).arguments.map((arg, i) => `\${${i + 1}:${arg.name}}`).join(", ") + ")$0");
            case 'funcDef': return new vscode.SnippetString(item.name + "(" + (item as IFuncDef).arguments.map((arg, i) => `\${${i + 1}:${arg.name}}`).join(", ") + ")$0");
          }
        })()
      });
    }

    return out;
  }

  public dispose = () => {
    for (const d of this.disposables) d.dispose();
  }

  private async handleRecognitionException(e: IRecognitionException, fullText: string) {
    const targetFileOffset = fullText.substring(0, ((e instanceof MismatchedTokenException) ? e.previousToken.startOffset : e.token.startOffset)).lastIndexOf("#__FILE__ ");
    const targetFileLineOffset = fullText.substring(0, targetFileOffset).split(/\r?\n/g).length + 2;
    const targetFileUri = vscode.Uri.file(fullText.substring(targetFileOffset + 10, fullText.substring(targetFileOffset).indexOf("\n\n") + 2));

    let diagnostic: vscode.Diagnostic;
    if (isNaN(e.token.startLine!) || e.token.image.startsWith("#__FILE__")) {
      let fileText: string;
      try { fileText = await readFile(targetFileUri.fsPath, "utf8"); } 
      catch (e) { console.error(e); return; }
      const lastLine = fileText.split(/\r?\n/g).length;
      diagnostic = new vscode.Diagnostic(
        new vscode.Range(lastLine, 0, lastLine, 1), 
        e.message, 
        vscode.DiagnosticSeverity.Error);
    } else {
      diagnostic = new vscode.Diagnostic(
        new vscode.Range(
          e.token.startLine! - targetFileLineOffset, e.token.startColumn! - 1, 
          e.token.endLine! - targetFileLineOffset, e.token.endColumn!),
        e.message,
        vscode.DiagnosticSeverity.Error);
    }
    
    this.diagnosticsCollection.set(targetFileUri, [diagnostic])
  }
  
  private parse = async (text: string, dir: string) => {    
    const lexingResult = RivalsAILexer.tokenize(text);

    this.parser.input = lexingResult.tokens;
    const cstNode = this.parser["file"]();

    if (this.parser.errors.length > 0) {
      for (const e of this.parser.errors) { 
        if (isRecognitionException(e)) { this.handleRecognitionException(e, text); }
        else {
          vscode.window.showErrorMessage((e as Error).message);
          console.error(e);
        }
      }
    } else {
      this.diagnosticsCollection.clear();
      try {
        this.visitorInstance!.visit(cstNode, text);
        this.completionItems = this.visitorInstance!.completionItems;
      } catch (e: any) {
        if (isRecognitionException(e)) { this.handleRecognitionException(e, text); }
        else if (
          e instanceof DuplicateIdentifierException
          || e instanceof HangingIdentifierException
          || e instanceof CallDNEException
          || e instanceof ArgCountMismatchException
          || e instanceof RefArgMismatchException
          || e instanceof ReservedException
          || e instanceof IdentDNEException
        ) {
          const targetFileUri = vscode.Uri.file(e.currFile.name);

          const imageLines = e.image.split(/\r?\n/g);
          const offsetStartLine = e.startLine - e.currFile.startLine - 1;
          let endColumn = e.startColumn + e.image.length;
          if (imageLines.length > 1) {
            endColumn = imageLines[imageLines.length - 1].length;
          }

          const diagnostic = new vscode.Diagnostic(
             new vscode.Range(offsetStartLine, e.startColumn - 1, offsetStartLine, endColumn - 1), 
            e.message, 
            vscode.DiagnosticSeverity.Error);

          this.diagnosticsCollection.set(targetFileUri, [diagnostic])
        } else {
          vscode.window.showErrorMessage((e as Error).message);
          console.error(e);
        }

      }
    }
  }

  private async updateFolder(dir: string, onParse?: (outPath: string) => Promise<void>) {
    const characterDir: string = vscode.workspace.getConfiguration("rai").get("characterDir") as string;

    const files = await readdir(dir);
    if (files.includes("main.rai")) {
      const mainFile = await readFile(pathJoin(dir, "main.rai"), "utf8");
      let idx;
      let outPath: string;
      if ((idx = mainFile.indexOf("#out")) == -1) {
        throw new Error(`no output specified in ${pathJoin(dir, "main.rai")}`)
      }
      const firstPiece = mainFile.substring(idx + 5);
      outPath = resolve(`${characterDir}/${firstPiece.replace(/\r/g, "").substring(0, firstPiece.indexOf("\n") - 1)}`);

      if ((idx = mainFile.indexOf("#extends")) != -1) {
        const firstExtendPiece = mainFile.substring(idx + 9);
        const parentAiPath = resolve(pathJoin(dir, "..", firstExtendPiece.replace(/\r/g, "").substring(0, firstExtendPiece.indexOf("\n") - 1)));
        await this.updateFolder(parentAiPath, onParse);
      }      
      
      const fileReadPromises: Promise<string>[] = [];
      const openFileUris = vscode.workspace.textDocuments.map(td => td.uri.fsPath);

      for (const file of files) {
        const filePath = pathJoin(`${dir}`, file);
        if (openFileUris.includes(filePath)) {
          fileReadPromises.push(new Promise((resolve) => resolve(vscode.workspace.textDocuments[openFileUris.indexOf(filePath)].getText())));
        } else {
          fileReadPromises.push(readFile(filePath, "utf8"));
        }
      }

      const readFiles = await Promise.all(fileReadPromises);

      let stitched = "";
      for (const [i, content] of readFiles.entries()) {
        stitched += `\n\n#__FILE__ ${pathJoin(dir, files[i])}\n\n` + content;
      }

      try {
        await this.parse(stitched, dir);
      } catch (e: any) {
        vscode.window.showErrorMessage(`compilation of ${dir} failed due to:\n${e.message}`);
        throw e;
      }

      if (onParse) await onParse(outPath);
    }
  }

  private async resetVisitorInstance(dir: string) {
    if (dir != this.currDir) {
      this.currDir = dir;
      this.VisitorClass = customVisitorFactory(this.parser, await loadBuiltins(), this.BaseRivalsAIVisitorClass);
      this.visitorInstance = new this.VisitorClass();
    }
    if (this.visitorInstance) {
      this.visitorInstance.fns.length = 0;
      this.visitorInstance.defines.length = 0;
      this.visitorInstance.scripts.length = 0;
      this.visitorInstance.mainScript = undefined;
      this.visitorInstance.currDepth = 0;
    }

    this.updateFolder(this.currDir)
  }

  private async handleDocOpen(textDoc: vscode.TextDocument) {
    if (textDoc.languageId !== "rai") return;
    
    this.resetVisitorInstance(dirname(textDoc.uri.fsPath));
  }

  private async handleDocSave(textDoc: vscode.TextDocument) {
    if (textDoc.languageId !== "rai") return;

    if (textDoc.uri.fsPath.endsWith("builtins.raid")) {
      this.VisitorClass = customVisitorFactory(this.parser, await loadBuiltins(), this.BaseRivalsAIVisitorClass);
      this.visitorInstance = new this.VisitorClass();
    }
    this.resetVisitorInstance(dirname(textDoc.uri.fsPath));
  }

  private async handleDocChange(textDoc: vscode.TextDocument) {
    if (textDoc.languageId !== "rai") return;

    if (this.docChangeTimer != null)
        clearTimeout(this.docChangeTimer);

    this.docChangeTimer = setInterval(() => {
        clearTimeout(this.docChangeTimer!);
        this.docChangeTimer = undefined;
        this.resetVisitorInstance(dirname(textDoc.uri.fsPath));
    }, 500);
  }

  private async handleConfigChange(changeEvt: vscode.ConfigurationChangeEvent) {
    if (changeEvt.affectsConfiguration("RAI Ext Options")) {
      this.VisitorClass = customVisitorFactory(this.parser, await loadBuiltins(), this.BaseRivalsAIVisitorClass);
      this.visitorInstance = new this.VisitorClass();
      if (this.currDir) {
        this.updateFolder(this.currDir);
      }
    }
  }

  private async compileAndExport() {
    if (!this.currDir) {
      vscode.window.showErrorMessage("no Rivals AI directory selected!");
      return;
    }

    this.VisitorClass = customVisitorFactory(this.parser, await loadBuiltins(), this.BaseRivalsAIVisitorClass);
    this.visitorInstance = new this.VisitorClass();
    await this.updateFolder(this.currDir, async (outPath) => {
      const {currDepth, mainScript, scripts, globals, fns, anonymousScopes} = this.visitorInstance!;
      const out = generateStruct(currDepth, mainScript!, scripts, fns, globals, anonymousScopes, await loadBuiltins());
    
      await writeFile(outPath, out);
      vscode.window.showInformationMessage(`successfully wrote: ${outPath}`);
    });
  }
}