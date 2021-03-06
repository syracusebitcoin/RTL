import { Component, OnInit, OnDestroy, ViewChild, Input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { Subject, forkJoin } from 'rxjs';
import { takeUntil, take } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { Actions } from '@ngrx/effects';
import { faHistory } from '@fortawesome/free-solid-svg-icons';

import { MatPaginator, MatPaginatorIntl } from '@angular/material/paginator';
import { MatSort } from '@angular/material/sort';
import { MatTableDataSource } from '@angular/material/table';
import { GetInfo, Payment, PayRequest, Channel, PaymentHTLC, Peer, Hop } from '../../../shared/models/lndModels';
import { PAGE_SIZE, PAGE_SIZE_OPTIONS, getPaginatorLabel, AlertTypeEnum, DataTypeEnum, ScreenSizeEnum, CurrencyUnitEnum, CURRENCY_UNIT_FORMATS, FEE_LIMIT_TYPES } from '../../../shared/services/consts-enums-functions';
import { LoggerService } from '../../../shared/services/logger.service';
import { CommonService } from '../../../shared/services/common.service';
import { DataService } from '../../../shared/services/data.service';

import { SelNodeChild } from '../../../shared/models/RTLconfig';
import { LightningSendPaymentsComponent } from '../send-payment-modal/send-payment.component';
import { newlyAddedRowAnimation } from '../../../shared/animation/row-animation';
import { LNDEffects } from '../../store/lnd.effects';
import { RTLEffects } from '../../../store/rtl.effects';
import * as LNDActions from '../../store/lnd.actions';
import * as RTLActions from '../../../store/rtl.actions';
import * as fromRTLReducer from '../../../store/rtl.reducers';

@Component({
  selector: 'rtl-lightning-payments',
  templateUrl: './lightning-payments.component.html',
  styleUrls: ['./lightning-payments.component.scss'],
  animations: [newlyAddedRowAnimation],
  providers: [
    { provide: MatPaginatorIntl, useValue: getPaginatorLabel('Payments') }
  ]  
})
export class LightningPaymentsComponent implements OnInit, OnDestroy {
  @Input() showDetails = true;
  @ViewChild('sendPaymentForm', { static: true }) form;
  @ViewChild(MatSort, { static: true }) sort: MatSort;
  @ViewChild(MatPaginator, {static: true}) paginator: MatPaginator;
  public faHistory = faHistory;
  public newlyAddedPayment = '';
  public flgAnimate = true;
  public selNode: SelNodeChild = {};
  public flgLoading: Array<Boolean | 'error'> = [true];
  public information: GetInfo = {};
  public peers: Peer[] = [];
  public payments: any;
  public paymentJSONArr: Payment[] = [];
  public displayedColumns = [];
  public htlcColumns = [];
  public paymentDecoded: PayRequest = {};
  public paymentRequest = '';
  public paymentDecodedHint = '';
  public showAdvanced = false;
  public selActiveChannel: Channel = {};
  public activeChannels = {};
  public feeLimit = null;
  public selFeeLimitType = FEE_LIMIT_TYPES[0];
  public feeLimitTypes = FEE_LIMIT_TYPES;
  public flgSticky = false;
  public pageSize = PAGE_SIZE;
  public pageSizeOptions = PAGE_SIZE_OPTIONS;
  public screenSize = '';
  public screenSizeEnum = ScreenSizeEnum;
  private unSubs: Array<Subject<void>> = [new Subject(), new Subject(), new Subject(), new Subject()];

  constructor(private logger: LoggerService, private commonService: CommonService, private dataService: DataService, private store: Store<fromRTLReducer.RTLState>, private rtlEffects: RTLEffects, private lndEffects: LNDEffects, private decimalPipe: DecimalPipe, private actions$: Actions) {
    this.screenSize = this.commonService.getScreenSize();
    if(this.screenSize === ScreenSizeEnum.XS) {
      this.flgSticky = false;
      this.displayedColumns = ['creation_date', 'actions'];
      this.htlcColumns = ['groupTotal', 'groupAction'];
    } else if(this.screenSize === ScreenSizeEnum.SM) {
      this.flgSticky = false;
      this.displayedColumns = ['creation_date', 'value', 'actions'];
      this.htlcColumns = ['groupTotal', 'groupValue', 'groupAction'];
    } else if(this.screenSize === ScreenSizeEnum.MD) {
      this.flgSticky = false;
      this.displayedColumns = ['creation_date', 'fee', 'value', 'actions'];
      this.htlcColumns = ['groupTotal', 'groupFee', 'groupValue', 'groupAction'];
    } else {
      this.flgSticky = true;
      this.displayedColumns = ['creation_date', 'payment_hash', 'fee', 'value', 'hops', 'actions'];
      this.htlcColumns = ['groupTotal', 'groupHash', 'groupFee', 'groupValue', 'groupHops', 'groupAction'];
    }
  }

  ngOnInit() {
    this.store.select('lnd')
    .pipe(takeUntil(this.unSubs[0]))
    .subscribe((rtlStore) => {
      rtlStore.effectErrors.forEach(effectsErr => {
        if (effectsErr.action === 'FetchPayments') {
          this.flgLoading[0] = 'error';
        }
      });
      this.information = rtlStore.information;
      this.selNode = rtlStore.nodeSettings;
      this.peers = rtlStore.peers;
      this.activeChannels = rtlStore.allChannels.filter(channel => channel.active);
      this.paymentJSONArr = (rtlStore.payments && rtlStore.payments.length > 0) ? rtlStore.payments : [];
      this.payments = (rtlStore.payments) ?  new MatTableDataSource([]) : new MatTableDataSource<Payment>([...this.paymentJSONArr]);
      this.payments.data = this.paymentJSONArr;
      this.payments.sort = this.sort;
      this.payments.sortingDataAccessor = (data, sortHeaderId) => (data[sortHeaderId]  && isNaN(data[sortHeaderId])) ? data[sortHeaderId].toLocaleLowerCase() : +data[sortHeaderId];
      this.payments.paginator = this.paginator;
      setTimeout(() => { this.flgAnimate = false; }, 3000);
      if (this.flgLoading[0] !== 'error') {
        this.flgLoading[0] = ( this.paymentJSONArr) ? false : true;
      }
      this.logger.info(rtlStore);
    });
  }

  onSendPayment() {
    if(!this.paymentRequest) { return true; } 
    if ( this.paymentDecoded.timestamp_str) {
      this.sendPayment();
    } else {
      this.store.dispatch(new RTLActions.OpenSpinner('Decoding Payment...'));
      this.store.dispatch(new LNDActions.DecodePayment({routeParam: this.paymentRequest, fromDialog: false}));
      this.lndEffects.setDecodedPayment
      .pipe(take(1))
      .subscribe(decodedPayment => {
        this.paymentDecoded = decodedPayment;
        if (this.paymentDecoded.timestamp_str) {
          if (this.paymentDecoded.num_msat && !this.paymentDecoded.num_satoshis) {
            this.paymentDecoded.num_satoshis = (+this.paymentDecoded.num_msat / 1000).toString();
          } else {
            this.paymentDecoded.num_satoshis = '0';
          }
          this.sendPayment();
        } else {
          this.resetData();
        }
      });
    }

  }

  sendPayment() {
    this.flgAnimate = true;
    this.newlyAddedPayment = this.paymentDecoded.payment_hash;
    if (this.paymentDecoded.num_msat && !this.paymentDecoded.num_satoshis) {
      this.paymentDecoded.num_satoshis = (+this.paymentDecoded.num_msat / 1000).toString();
    }
    if (!this.paymentDecoded.num_satoshis || this.paymentDecoded.num_satoshis === '' ||  this.paymentDecoded.num_satoshis === '0') {
        const reorderedPaymentDecoded = [
          [{key: 'payment_hash', value: this.paymentDecoded.payment_hash, title: 'Payment Hash', width: 100}],
          [{key: 'destination', value: this.paymentDecoded.destination, title: 'Destination', width: 100}],
          [{key: 'description', value: this.paymentDecoded.description, title: 'Description', width: 100}],
          [{key: 'timestamp_str', value: this.paymentDecoded.timestamp_str, title: 'Creation Date', width: 40},
            {key: 'expiry', value: this.paymentDecoded.expiry, title: 'Expiry', width: 30, type: DataTypeEnum.NUMBER},
            {key: 'cltv_expiry', value: this.paymentDecoded.cltv_expiry, title: 'CLTV Expiry', width: 30}]
        ];
        const titleMsg = 'It is a zero amount invoice. Enter the amount (Sats) to pay.';
        this.store.dispatch(new RTLActions.OpenConfirmation({ data: {
          type: AlertTypeEnum.CONFIRM,
          alertTitle: 'Enter Amount and Confirm Send Payment',
          titleMessage: titleMsg,
          message: reorderedPaymentDecoded,
          noBtnText: 'Cancel',
          yesBtnText: 'Send Payment',
          flgShowInput: true,
          getInputs: [
            {placeholder: 'Amount (Sats)', inputType: DataTypeEnum.NUMBER.toLowerCase(), inputValue: '', width: 30}
          ]
        }}));
        this.rtlEffects.closeConfirm
        .pipe(take(1))
        .subscribe(confirmRes => {
          if (confirmRes) {
            this.paymentDecoded.num_satoshis = confirmRes[0].inputValue;
            this.store.dispatch(new RTLActions.OpenSpinner('Sending Payment...'));
            this.store.dispatch(new LNDActions.SendPayment({paymentReq: this.paymentRequest, paymentDecoded: this.paymentDecoded, zeroAmtInvoice: true, outgoingChannel: this.selActiveChannel, feeLimitType: this.selFeeLimitType, feeLimit: this.feeLimit, fromDialog: false}));
            this.resetData();
          }
        });
    } else {
      const reorderedPaymentDecoded = [
        [{key: 'payment_hash', value: this.paymentDecoded.payment_hash, title: 'Payment Hash', width: 100}],
        [{key: 'destination', value: this.paymentDecoded.destination, title: 'Destination', width: 100}],
        [{key: 'description', value: this.paymentDecoded.description, title: 'Description', width: 100}],
        [{key: 'timestamp_str', value: this.paymentDecoded.timestamp_str, title: 'Creation Date', width: 50},
          {key: 'num_satoshis', value: this.paymentDecoded.num_satoshis, title: 'Amount (Sats)', width: 50, type: DataTypeEnum.NUMBER}],
        [{key: 'expiry', value: this.paymentDecoded.expiry, title: 'Expiry', width: 50, type: DataTypeEnum.NUMBER},
          {key: 'cltv_expiry', value: this.paymentDecoded.cltv_expiry, title: 'CLTV Expiry', width: 50}]
      ];
      this.store.dispatch(new RTLActions.OpenConfirmation({ data: {
        type: AlertTypeEnum.CONFIRM,
        alertTitle: 'Confirm Send Payment',
        noBtnText: 'Cancel',
        yesBtnText: 'Send Payment',
        message: reorderedPaymentDecoded
      }}));
      this.rtlEffects.closeConfirm
      .pipe(take(1))
      .subscribe(confirmRes => {
        if (confirmRes) {
          this.store.dispatch(new RTLActions.OpenSpinner('Sending Payment...'));
          this.store.dispatch(new LNDActions.SendPayment({paymentReq: this.paymentRequest, paymentDecoded: this.paymentDecoded, zeroAmtInvoice: false, outgoingChannel: this.selActiveChannel, feeLimitType: this.selFeeLimitType, feeLimit: this.feeLimit, fromDialog: false}));
          this.resetData();
        }
      });
    }
  }

  openSendPaymentModal() {
    this.store.dispatch(new RTLActions.OpenAlert({ data: { 
      component: LightningSendPaymentsComponent
    }}));
  }

  onPaymentRequestEntry(event: any) {
    this.paymentRequest = event;
    this.paymentDecodedHint = '';
    if(this.paymentRequest && this.paymentRequest.length > 100) {
      this.store.dispatch(new RTLActions.OpenSpinner('Decoding Payment...'));
      this.store.dispatch(new LNDActions.DecodePayment({routeParam: this.paymentRequest, fromDialog: false}));
      this.lndEffects.setDecodedPayment.pipe(take(1)).subscribe(decodedPayment => {
        this.paymentDecoded = decodedPayment;
        if (this.paymentDecoded.num_msat && !this.paymentDecoded.num_satoshis) {
          this.paymentDecoded.num_satoshis = (+this.paymentDecoded.num_msat / 1000).toString();
        }
        if(this.paymentDecoded.num_satoshis) {
          this.commonService.convertCurrency(+this.paymentDecoded.num_satoshis, CurrencyUnitEnum.SATS, this.selNode.currencyUnits[2], this.selNode.fiatConversion)
          .pipe(takeUntil(this.unSubs[2]))
          .subscribe(data => {
            if(this.selNode.fiatConversion) {
              this.paymentDecodedHint = 'Sending: ' + this.decimalPipe.transform(this.paymentDecoded.num_satoshis ? this.paymentDecoded.num_satoshis : 0) + ' Sats (' + data.symbol + this.decimalPipe.transform((data.OTHER ? data.OTHER : 0), CURRENCY_UNIT_FORMATS.OTHER) + ') | Memo: ' + this.paymentDecoded.description;
            } else {
              this.paymentDecodedHint = 'Sending: ' + this.decimalPipe.transform(this.paymentDecoded.num_satoshis ? this.paymentDecoded.num_satoshis : 0) + ' Sats | Memo: ' + this.paymentDecoded.description;
            }
          });
        } else {
          this.paymentDecodedHint = 'Zero Amount Invoice | Memo: ' + this.paymentDecoded.description;
        }
      });
    }
  }

  onShowAdvanced() {
    this.showAdvanced = !this.showAdvanced;
    if (!this.showAdvanced) {
      this.selActiveChannel = null;
      this.feeLimit = null;
      this.selFeeLimitType = FEE_LIMIT_TYPES[0];
    }
  }

  is_group(index: number, payment: Payment) {
    return payment.htlcs && payment.htlcs.length > 1;
  }  

  resetData() {
    this.paymentDecoded = {};
    this.paymentRequest = '';
    this.selActiveChannel = null;
    this.feeLimit = null;
    this.selFeeLimitType = FEE_LIMIT_TYPES[0];
    this.form.resetForm();
  }

  getHopDetails(hops: Hop[]) {
    let self = this;
    return hops.reduce(function (accumulator, currentHop) {
      let peerFound = self.peers.find(peer => peer.pub_key === currentHop.pub_key);
      if (peerFound && peerFound.alias) {
        accumulator.push('<pre>Channel: ' + peerFound.alias.padEnd(20) + '&Tab;&Tab;&Tab;Amount (Sats): ' + self.decimalPipe.transform(currentHop.amt_to_forward) + '</pre>');
      } else {
        self.dataService.getAliasFromPubkey(currentHop.pub_key)
        .pipe(takeUntil(self.unSubs[1]))
        .subscribe((res: any) => {
          accumulator.push('<pre>Channel: ' + (res.node && res.node.alias ? res.node.alias.padEnd(20) : (currentHop.pub_key.substring(0, 17) + '...')) + '&Tab;&Tab;&Tab;Amount (Sats): ' + self.decimalPipe.transform(currentHop.amt_to_forward) + '</pre>');
        });
      }
      return accumulator;
    }, []);
  }

  onHTLCClick(selHtlc: PaymentHTLC, selPayment: Payment) {
    const reorderedHTLC = [
      [{key: 'payment_hash', value: selPayment.payment_hash, title: 'Payment Hash', width: 100, type: DataTypeEnum.STRING}],
      [{key: 'payment_request', value: selPayment.payment_request, title: 'Payment Request', width: 100, type: DataTypeEnum.STRING}],
      [{key: 'preimage', value: selHtlc.preimage, title: 'Preimage', width: 100, type: DataTypeEnum.STRING}],
      [{key: 'status', value: selHtlc.status, title: 'Status', width: 33, type: DataTypeEnum.STRING},
        {key: 'attempt_time_str', value: selHtlc.attempt_time_str, title: 'Attempt Time', width: 33, type: DataTypeEnum.DATE_TIME},
        {key: 'resolve_time_str', value: selHtlc.resolve_time_str, title: 'Resolve Time', width: 34, type: DataTypeEnum.DATE_TIME}],
      [{key: 'total_amt', value: selHtlc.route.total_amt, title: 'Amount (Sats)', width: 33, type: DataTypeEnum.NUMBER},
        {key: 'total_fees', value: selHtlc.route.total_fees, title: 'Fee (Sats)', width: 33, type: DataTypeEnum.NUMBER},
        {key: 'total_time_lock', value: selHtlc.route.total_time_lock, title: 'Total Time Lock', width: 34, type: DataTypeEnum.NUMBER}],
      [{key: 'hops', value: this.getHopDetails(selHtlc.route.hops), title: 'Hops', width: 100, type: DataTypeEnum.ARRAY}]
    ];
    this.store.dispatch(new RTLActions.OpenAlert({ data: {
      type: AlertTypeEnum.INFORMATION,
      alertTitle: 'HTLC Information',
      message: reorderedHTLC,
      scrollable: selHtlc.route && selHtlc.route.hops && selHtlc.route.hops.length > 1
    }}));
  }

  onPaymentClick(selPayment: Payment) {
    const reorderedPayment = [
      [{key: 'payment_hash', value: selPayment.payment_hash, title: 'Payment Hash', width: 100, type: DataTypeEnum.STRING}],
      [{key: 'payment_preimage', value: selPayment.payment_preimage, title: 'Payment Preimage', width: 100, type: DataTypeEnum.STRING}],
      [{key: 'payment_request', value: selPayment.payment_request, title: 'Payment Request', width: 100, type: DataTypeEnum.STRING}],
      [{key: 'status', value: selPayment.status, title: 'Status', width: 50, type: DataTypeEnum.STRING},
        {key: 'creation_date_str', value: selPayment.creation_date_str, title: 'Creation Date', width: 50, type: DataTypeEnum.DATE_TIME}],
      [{key: 'value_msat', value: selPayment.value_msat, title: 'Value (mSats)', width: 50, type: DataTypeEnum.NUMBER},
        {key: 'fee_msat', value: selPayment.fee_msat, title: 'Fee (mSats)', width: 50, type: DataTypeEnum.NUMBER}]
    ];
    this.store.dispatch(new RTLActions.OpenAlert({ data: {
      type: AlertTypeEnum.INFORMATION,
      alertTitle: 'Payment Information',
      message: reorderedPayment
    }}));
  }

  applyFilter(selFilter: string) {
    this.payments.filter = selFilter;
  }

  onDownloadCSV() {
    if(this.payments.data && this.payments.data.length > 0) {
      let paymentsDataCopy = JSON.parse(JSON.stringify(this.payments.data));
      let flattenedPayments = paymentsDataCopy.reduce((acc, curr) => {
        if (curr.htlcs) {
          return acc.concat(curr.htlcs);
        } else {
          return acc.concat(curr);
        }
      }, []);      
      this.commonService.downloadFile(flattenedPayments, 'Payments');
    }
  }

  ngOnDestroy() {
    this.unSubs.forEach(completeSub => {
      completeSub.next();
      completeSub.complete();
    });
  }

}
