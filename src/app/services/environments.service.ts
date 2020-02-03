
import { Injectable } from '@angular/core';
import * as storage from 'electron-json-storage';
import { cloneDeep } from 'lodash';
import { debounceTime } from 'rxjs/operators';
import { AnalyticsEvents } from 'src/app/enums/analytics-events.enum';
import { DataService } from 'src/app/services/data.service';
import { EventsService } from 'src/app/services/events.service';
import { MigrationService } from 'src/app/services/migration.service';
import { SchemasBuilderService } from 'src/app/services/schemas-builder.service';
import { ServerService } from 'src/app/services/server.service';
import { UIService } from 'src/app/services/ui.service';
import { addEnvironmentAction, addRouteAction, addRouteResponseAction, moveEnvironmentsAction, moveRouteResponsesAction, moveRoutesAction, navigateEnvironmentsAction, navigateRoutesAction, removeEnvironmentAction, removeRouteAction, removeRouteResponseAction, setActiveEnvironmentAction, setActiveEnvironmentLogTabAction, setActiveRouteAction, setActiveRouteResponseAction, setActiveTabAction, setActiveViewAction, setInitialEnvironmentsAction, updateEnvironmentAction, updateRouteAction, updateRouteResponseAction } from 'src/app/stores/actions';
import { ReducerDirectionType } from 'src/app/stores/reducer';
import { EnvironmentLogsTabsNameType, Store, TabsNameType, ViewsNameType } from 'src/app/stores/store';
import { Environment, EnvironmentProperties } from 'src/app/types/environment.type';
import { CORSHeaders, Header, Method, Route, RouteProperties, RouteResponse, RouteResponseProperties } from 'src/app/types/route.type';
import { DraggableContainerNames, ScrollDirection } from 'src/app/types/ui.type';

@Injectable({ providedIn: 'root' })
export class EnvironmentsService {
  private storageKey = 'environments';

  constructor(
    private dataService: DataService,
    private eventsService: EventsService,
    private store: Store,
    private serverService: ServerService,
    private migrationService: MigrationService,
    private schemasBuilderService: SchemasBuilderService,
    private uiService: UIService
  ) {
    // get existing environments from storage or default one
    storage.get(this.storageKey, (_error: any, environments: Environment[]) => {
      // if empty object build default starting env
      if (Object.keys(environments).length === 0 && environments.constructor === Object) {
        this.store.update(setInitialEnvironmentsAction([this.schemasBuilderService.buildDefaultEnvironment()]));
      } else {
        this.store.update(setInitialEnvironmentsAction(this.migrationService.migrateEnvironments(environments)));
      }
    });

    // subscribe to environments update to save
    this.store.select('environments').pipe(debounceTime(2000)).subscribe((environments) => {
      storage.set(this.storageKey, environments);
    });
  }

  /**
   * Set active environment by UUID or navigation
   */
  public setActiveEnvironment(environmentUUIDOrDirection: string | ReducerDirectionType) {
    if (this.store.get('activeEnvironmentUUID') !== environmentUUIDOrDirection) {
      if (environmentUUIDOrDirection === 'next' || environmentUUIDOrDirection === 'previous') {
        this.store.update(navigateEnvironmentsAction(environmentUUIDOrDirection));
      } else {
        this.store.update(setActiveEnvironmentAction(environmentUUIDOrDirection));
      }

      this.eventsService.analyticsEvents.next(AnalyticsEvents.NAVIGATE_ENVIRONMENT);
    }
  }

  /**
   * Set active route by UUID or navigation
   */
  public setActiveRoute(routeUUIDOrDirection: string | ReducerDirectionType) {
    const activeRouteUUID = this.store.get('activeRouteUUID');

    if (activeRouteUUID && activeRouteUUID !== routeUUIDOrDirection) {
      if (routeUUIDOrDirection === 'next' || routeUUIDOrDirection === 'previous') {
        this.store.update(navigateRoutesAction(routeUUIDOrDirection));
      } else {
        this.store.update(setActiveRouteAction(routeUUIDOrDirection));
      }

      this.eventsService.analyticsEvents.next(AnalyticsEvents.NAVIGATE_ROUTE);
    }
  }

  /**
   * Add a new environment and save it in the store
   */
  public addEnvironment() {
    this.store.update(addEnvironmentAction(this.schemasBuilderService.buildEnvironment()));
    this.eventsService.analyticsEvents.next(AnalyticsEvents.CREATE_ENVIRONMENT);
  }

  /**
   * Duplicate an environment, or the active environment and append it at the end of the list.
   */
  public duplicateEnvironment(environmentUUID?: string) {
    let environmentToDuplicate = this.store.getActiveEnvironment();

    if (environmentUUID) {
      environmentToDuplicate = this.store.get('environments').find(environment => environment.uuid === environmentUUID);
    }

    if (environmentToDuplicate) {
      // copy the environment, reset some properties and change name
      let newEnvironment: Environment = {
        ...cloneDeep(environmentToDuplicate),
        name: `${environmentToDuplicate.name} (copy)`,
        port: this.dataService.getNewEnvironmentPort()
      };

      newEnvironment = this.dataService.renewEnvironmentUUIDs(newEnvironment);

      this.store.update(addEnvironmentAction(newEnvironment));

      this.eventsService.analyticsEvents.next(AnalyticsEvents.DUPLICATE_ENVIRONMENT);

      this.uiService.scrollEnvironmentsMenu.next(ScrollDirection.BOTTOM);
    }
  }

  /**
   * Remove an environment or the current one if not environmentUUID is provided
   */
  public removeEnvironment(environmentUUID: string = this.store.get('activeEnvironmentUUID')) {
    if (environmentUUID) {
      this.serverService.stop(environmentUUID);

      this.store.update(removeEnvironmentAction(environmentUUID));
      this.eventsService.analyticsEvents.next(AnalyticsEvents.DELETE_ENVIRONMENT);
    }
  }

  /**
   * Add a new route and save it in the store
   */
  public addRoute() {
    if (this.store.getActiveEnvironment()) {
      this.store.update(addRouteAction(this.schemasBuilderService.buildRoute()));
      this.eventsService.analyticsEvents.next(AnalyticsEvents.CREATE_ROUTE);
      this.uiService.scrollRoutesMenu.next(ScrollDirection.BOTTOM);
    }
  }

  /**
   * Add a new route response and save it in the store
   */
  public addRouteResponse() {
    this.store.update(addRouteResponseAction(this.schemasBuilderService.buildRouteResponse()));
    this.eventsService.analyticsEvents.next(AnalyticsEvents.CREATE_ROUTE_RESPONSE);
  }

  /**
   * Duplicate a route, or the current active route and append it at the end
   */
  public duplicateRoute(routeUUID?: string) {
    let routeToDuplicate = this.store.getActiveRoute();

    if (routeUUID) {
      routeToDuplicate = this.store.getActiveEnvironment().routes.find(route => route.uuid === routeUUID);
    }

    if (routeToDuplicate) {
      let newRoute: Route = cloneDeep(routeToDuplicate);

      newRoute = this.dataService.renewRouteUUIDs(newRoute);

      this.store.update(addRouteAction(newRoute));

      this.eventsService.analyticsEvents.next(AnalyticsEvents.DUPLICATE_ROUTE);
      this.uiService.scrollRoutesMenu.next(ScrollDirection.BOTTOM);
    }
  }

  /**
   * Remove a route and save
   */
  public removeRoute(routeUUID: string = this.store.get('activeRouteUUID')) {
    if (routeUUID) {
      this.store.update(removeRouteAction(routeUUID));

      this.eventsService.analyticsEvents.next(AnalyticsEvents.DELETE_ROUTE);
    }
  }

  /**
   * Remove current route response and save
   */
  public removeRouteResponse() {
    this.store.update(removeRouteResponseAction());

    this.eventsService.analyticsEvents.next(AnalyticsEvents.DELETE_ROUTE_RESPONSE);
  }

  /**
   * Enable and disable a route
   */
  public toggleRoute(routeUUID?: string) {
    const selectedRoute = this.store.getActiveEnvironment().routes.find(route => route.uuid === routeUUID);
    if (selectedRoute) {
      this.store.update(updateRouteAction({
        uuid: selectedRoute.uuid,
        enabled: !selectedRoute.enabled
      }));
    }
  }

  /**
   * Set active tab
   */
  public setActiveTab(activeTab: TabsNameType) {
    this.store.update(setActiveTabAction(activeTab));
  }

  /**
   * Set active environment logs tab
   */
  public setActiveEnvironmentLogTab(activeTab: EnvironmentLogsTabsNameType) {
    this.store.update(setActiveEnvironmentLogTabAction(activeTab));
  }

  /**
   * Set active view
   */
  public setActiveView(activeView: ViewsNameType) {
    this.store.update(setActiveViewAction(activeView));
  }

  /**
   * Set active view
   */
  public setActiveRouteResponse(routeResponseUUID: string) {
    this.store.update(setActiveRouteResponseAction(routeResponseUUID));
  }

  /**
   * Update the active environment
   */
  public updateActiveEnvironment(properties: EnvironmentProperties) {
    this.store.update(updateEnvironmentAction(properties));
  }

  /**
   * Update the active route
   */
  public updateActiveRoute(properties: RouteProperties) {
    this.store.update(updateRouteAction(properties));
  }

  /**
   * Update the active route response
   */
  public updateActiveRouteResponse(properties: RouteResponseProperties) {
    this.store.update(updateRouteResponseAction(properties));
  }

  /**
   * Start / stop active environment
   */
  public toggleActiveEnvironment() {
    const activeEnvironment = this.store.getActiveEnvironment();

    if (!activeEnvironment) {
      return;
    }

    const environmentsStatus = this.store.get('environmentsStatus');
    const activeEnvironmentState = environmentsStatus[activeEnvironment.uuid];

    if (activeEnvironmentState.running) {
      this.serverService.stop(activeEnvironment.uuid);

      this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_STOP);

      if (activeEnvironmentState.needRestart) {
        this.serverService.start(activeEnvironment);
        this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_RESTART);
      }
    } else {
      this.serverService.start(activeEnvironment);
      this.eventsService.analyticsEvents.next(AnalyticsEvents.SERVER_START);
    }
  }

  /**
   * Move a menu item (envs / routes)
   */
  public moveMenuItem(type: DraggableContainerNames, sourceIndex: number, targetIndex: number) {
    const storeActions = {
      routes: moveRoutesAction,
      environments: moveEnvironmentsAction,
      routeResponses: moveRouteResponsesAction
    };

    this.store.update(storeActions[type]({ sourceIndex, targetIndex }));
  }

  /**
   * Check if active environment has headers
   */
  public hasEnvironmentHeaders() {
    const activeEnvironment = this.store.getActiveEnvironment();

    return activeEnvironment && activeEnvironment.headers.some(header => !!header.key);
  }

  /**
   * Emit an headers injection event in order to add CORS headers to the headers list component
   */
  public setEnvironmentCORSHeaders() {
    this.eventsService.injectHeaders.emit({ target: 'environmentHeaders', headers: CORSHeaders });
  }

  /**
   * Create a route based on a environment log entry
   */
  public createRouteFromLog(logUUID?: string) {
    const environmentsLogs = this.store.get('environmentsLogs');
    const uuidEnvironment = this.store.get('activeEnvironmentUUID');
    const log = environmentsLogs[uuidEnvironment].find(environmentLog => environmentLog.uuid === logUUID);

    if (log) {
      let routeResponse: RouteResponse;

      if (log.response) {
        const headers: Header[] = [];
        log.response.headers.forEach(element => {
          if (Array.isArray(element.value)) {
            element.value.forEach(v => {
              headers.push(
                this.schemasBuilderService.buildHeader(element.name, v)
              );
            })
          } else {
            headers.push(
              this.schemasBuilderService.buildHeader(element.name, element.value)
            );
          }
        });

        routeResponse = {
          ...this.schemasBuilderService.buildRouteResponse(),
          headers,
          statusCode: log.response.status.toString(),
          body: log.response.body
        };
      } else {
        routeResponse = this.schemasBuilderService.buildRouteResponse();
      }

      const newRoute: Route = {
        ...this.schemasBuilderService.buildRoute(),
        method: log.method.toLowerCase() as Method,
        endpoint: log.url.slice(1), // Remove the initial slash '/'
        responses: [routeResponse]
      };

      this.store.update(addRouteAction(newRoute));

      this.eventsService.analyticsEvents.next(AnalyticsEvents.CREATE_ROUTE_FROM_LOG);
    }
  }
}
