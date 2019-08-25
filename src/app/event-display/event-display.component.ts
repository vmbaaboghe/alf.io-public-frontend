import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { EventService } from '../shared/event.service';
import { ActivatedRoute, Router } from '@angular/router';
import {FormGroup, FormBuilder, FormArray} from '@angular/forms';
import { ReservationService } from '../shared/reservation.service';
import { Event } from '../model/event';
import { TranslateService } from '@ngx-translate/core';
import { TicketCategory } from '../model/ticket-category';
import { ReservationRequest } from '../model/reservation-request';
import { handleServerSideValidationError } from '../shared/validation-helper';
import { zip } from 'rxjs';
import { AdditionalService } from '../model/additional-service';
import { I18nService } from '../shared/i18n.service';
import { WaitingListSubscriptionRequest } from '../model/waiting-list-subscription-request';
import { TicketCategoryForWaitingList, ItemsByCategory } from '../model/items-by-category';
import { EventCode } from '../model/event-code';
import { AnalyticsService } from '../shared/analytics.service';
import { ErrorDescriptor } from '../model/validated-response';

@Component({
  selector: 'app-event-display',
  templateUrl: './event-display.component.html',
  styleUrls: ['./event-display.component.scss']
})
export class EventDisplayComponent implements OnInit {

  event: Event;
  ticketCategories: TicketCategory[];
  //
  supplementCategories: AdditionalService[];
  donationCategories: AdditionalService[];
  //
  reservationForm: FormGroup;
  globalErrors: ErrorDescriptor[] = [];
  //
  ticketCategoryAmount: {[key: number]: number[]};
  //

  //
  preSales: boolean;
  waitingList: boolean;
  ticketCategoriesForWaitingList: TicketCategoryForWaitingList[];
  waitingListForm: FormGroup;
  waitingListRequestSubmitted: boolean;
  waitingListRequestResult: boolean;
  //

  eventCode: EventCode;
  eventCodeError: boolean;

  displayPromoCodeForm: boolean;
  promoCodeForm: FormGroup;
  @ViewChild('promoCode', {static: false})
  promoCodeElement: ElementRef<HTMLInputElement>;
  @ViewChild('tickets', { static: false })
  tickets: ElementRef<HTMLDivElement>;

  // https://alligator.io/angular/reactive-forms-formarray-dynamic-fields/

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private eventService: EventService,
    private reservationService: ReservationService,
    private formBuilder: FormBuilder,
    public translate: TranslateService,
    private i18nService: I18nService,
    private analytics: AnalyticsService) { }

  ngOnInit(): void {

    const code = this.route.snapshot.queryParams['code'];
    const errors = this.route.snapshot.queryParams['errors'];
    if (errors) {
      this.globalErrors = errors.split(',').map(val => { const ed = new ErrorDescriptor(); ed.code = val; return ed; });
    }

    this.route.params.subscribe(params => {
      const eventShortName = params['eventShortName'];

      zip(this.eventService.getEvent(eventShortName), this.eventService.getEventTicketsInfo(eventShortName)).subscribe( ([event, itemsByCat]) => {
        this.event = event;

        this.i18nService.setPageTitle('show-event.header.title', event.displayName);

        this.reservationForm = this.formBuilder.group({
          reservation: this.formBuilder.array(this.createItems(itemsByCat.ticketCategories)),
          additionalService: this.formBuilder.array([]),
          captcha: null,
          promoCode: null
        });

        this.promoCodeForm = this.formBuilder.group({
          promoCode: this.formBuilder.control(code)
        });

        this.applyItemsByCat(itemsByCat);
        this.analytics.pageView(event.analyticsConfiguration);

        if (code) {
          this.internalApplyPromoCode(code, err => this.globalErrors = err);
        }
      });
    });
  }

  private applyItemsByCat(itemsByCat: ItemsByCategory) {
    this.ticketCategories = itemsByCat.ticketCategories;

    this.ticketCategoryAmount = {};
    this.ticketCategories.forEach(tc => {
      this.ticketCategoryAmount[tc.id] = [];
      for (let i = 0; i <= tc.maximumSaleableTickets; i++) {
        this.ticketCategoryAmount[tc.id].push(i);
      }
    });

    this.supplementCategories = itemsByCat.additionalServices.filter(e => e.type === 'SUPPLEMENT');
    this.donationCategories = itemsByCat.additionalServices.filter(e => e.type === 'DONATION');

    this.preSales = itemsByCat.preSales;
    this.waitingList = itemsByCat.waitingList;
    this.ticketCategoriesForWaitingList = itemsByCat.ticketCategoriesForWaitingList;

    this.createWaitingListFormIfNecessary();
  }

  private createWaitingListFormIfNecessary() {
    if (this.waitingList && !this.waitingListForm) {
      this.waitingListForm = this.formBuilder.group({
        firstName: null,
        lastName: null,
        email: null,
        selectedCategory: null,
        userLanguage: null,
        termAndConditionsAccepted: null,
        privacyPolicyAccepted: null
      });
    }
  }

  private createItems(ticketCategories: TicketCategory[]): FormGroup[] {
    return ticketCategories.map(category => this.formBuilder.group({ticketCategoryId: category.id, amount: 0}));
  }

  submitForm(eventShortName: string, reservation: ReservationRequest) {
    this.reservationService.reserveTickets(eventShortName, reservation, this.translate.currentLang).subscribe(res => {
      if (res.success) {
        this.router.navigate(['event', eventShortName, 'reservation', res.value, 'book']);
      }
    }, (err) => {
      this.globalErrors = handleServerSideValidationError(err, this.reservationForm);
    });
  }

  submitWaitingListRequest(eventShortName: string, waitingListSubscriptionRequest: WaitingListSubscriptionRequest) {

    this.eventService.submitWaitingListSubscriptionRequest(eventShortName, waitingListSubscriptionRequest).subscribe(res => {
      this.waitingListRequestSubmitted = true;
      this.waitingListRequestResult = res.value;
    }, (err) => {
      this.globalErrors = handleServerSideValidationError(err, this.waitingListForm);
    });
  }

  handleRecaptchaResponse(recaptchaValue: string): void {
    this.reservationForm.get('captcha').setValue(recaptchaValue);
  }

  private internalApplyPromoCode(promoCode: string, errorHandler: ((errors: ErrorDescriptor[]) => void)): void {
    this.globalErrors = [];
    this.eventCodeError = false;

    if (promoCode === null || promoCode === undefined || promoCode.trim() === '') {
      return;
    }

    this.eventService.validateCode(this.event.shortName, promoCode).subscribe(res => {
      if (res.success) {
        // this.router.navigate([], {relativeTo: this.route, queryParams: {code: promoCode}, queryParamsHandling: "merge"})
        // TODO, set promo code in url, fetch ticket category, rebuild the reservationForm.reservation

        //
        this.reloadTicketsInfo(promoCode, res.value);
        this.displayPromoCodeForm = false;
        //
      } else {
        this.eventCode = null; // should never enter here
        this.reservationForm.get('promoCode').setValue(null);
      }
    }, (err) => {
      errorHandler(handleServerSideValidationError(err, this.promoCodeForm));
      this.eventCode = null;
      this.reloadTicketsInfo(null, null);
      this.eventCodeError = true;
    });
  }

  applyPromoCode(): void {
    const promoCode = this.promoCodeForm.get('promoCode').value;
    this.globalErrors = [];
    this.internalApplyPromoCode(promoCode, () => {});
  }

  removePromoCode(): void {
    this.reloadTicketsInfo(null, null);
  }

  togglePromoCodeVisible(): void {
    this.displayPromoCodeForm = !this.displayPromoCodeForm;
    if (this.displayPromoCodeForm) {
      setTimeout(() => this.promoCodeElement.nativeElement.focus());
    } else {
      this.promoCodeForm.get('promoCode').setValue(null);
    }
  }

  ticketsLeftCountVisible(): boolean {
     return this.event.availableTicketsCount != null
       && this.event.availableTicketsCount > 0
       && this.ticketCategories.every(tc => !tc.bounded);
  }

  reservationFormItem(parent: FormGroup, counter: number): FormGroup {
    return (parent.get('reservation') as FormArray).at(counter) as FormGroup;
  }

  ticketsLeftCountVisibleForCategory(category: TicketCategory): boolean {
    return category.availableTickets != null && category.availableTickets > 0;
  }

  private reloadTicketsInfo(promoCode: string, eventCode: EventCode) {
    this.eventService.getEventTicketsInfo(this.event.shortName, promoCode).subscribe(itemsByCat => {
      this.reservationForm.get('promoCode').setValue(promoCode);
      this.reservationForm.setControl('reservation', this.formBuilder.array(this.createItems(itemsByCat.ticketCategories)));
      this.applyItemsByCat(itemsByCat);
      this.eventCode = eventCode;
      if (eventCode != null) {
        setTimeout(() => this.tickets.nativeElement.scrollIntoView(true), 10);
      }
    });
  }
}
