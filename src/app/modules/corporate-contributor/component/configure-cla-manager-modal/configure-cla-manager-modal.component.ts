// Copyright The Linux Foundation and each contributor to CommunityBridge.
// SPDX-License-Identifier: MIT

import { Component, EventEmitter, OnInit, Output, TemplateRef, ViewChild } from '@angular/core';
import { ClaContributorService } from 'src/app/core/services/cla-contributor.service';
import { AuthService } from 'src/app/shared/services/auth.service';
import { AppSettings } from 'src/app/config/app-settings';
import { StorageService } from 'src/app/shared/services/storage.service';
import { NgbModal } from '@ng-bootstrap/ng-bootstrap';
import { CompanyModel, OrganizationModel } from 'src/app/core/models/organization';
import { AlertService } from 'src/app/shared/services/alert.service';
import { UserModel } from 'src/app/core/models/user';
import { LoaderService } from 'src/app/shared/services/loader.service';

@Component({
  selector: 'app-configure-cla-manager-modal',
  templateUrl: './configure-cla-manager-modal.component.html',
  styleUrls: ['./configure-cla-manager-modal.component.scss']
})
export class ConfigureClaManagerModalComponent implements OnInit {
  @ViewChild('errorModal') errorModal: TemplateRef<any>;
  @ViewChild('warningModal') warningModal: TemplateRef<any>;
  @Output() showCloseBtnEmitter: EventEmitter<any> = new EventEmitter<any>();

  title: string;
  message: string;
  company: OrganizationModel;
  hasCLAManagerDesignee: boolean;
  spinnerMessage: string;
  companyId: string;
  failedCount: number;

  constructor(
    private claContributorService: ClaContributorService,
    private authService: AuthService,
    private storageService: StorageService,
    private modalService: NgbModal,
    private alertService: AlertService,
    private loaderService: LoaderService
  ) {
    this.hasCLAManagerDesignee = false;
    this.showCloseBtnEmitter.emit(false);
    setTimeout(() => {
      this.addOrganizationIfNotAdded();
    }, 100);
  }

  ngOnInit() {
    this.failedCount = 0;
    this.company = JSON.parse(this.storageService.getItem(AppSettings.SELECTED_COMPANY));
  }

  manageAuthRedirection() {
    this.spinnerMessage = 'Please wait while we configure the initial CLA Manager settings for this CLA.';
    const actionType = JSON.parse(this.storageService.getItem(AppSettings.ACTION_TYPE));
    if (actionType === AppSettings.SIGN_CLA) {
      this.addContributorAsDesignee();
    } else {
      this.validateUserLFID();
    }
  }

  addOrganizationIfNotAdded() {
    const data = JSON.parse(this.storageService.getItem(AppSettings.NEW_ORGANIZATIONS));
    if (data !== undefined && data !== null) {
      // Add organization if it is not created.
      this.spinnerMessage = 'Please wait for a moment, we are adding the organization.';
      this.addNewOrganization(data);
    } else {
      this.manageAuthRedirection();
    }
  }


  addNewOrganization(data) {
    const userModel: UserModel = JSON.parse(this.storageService.getItem(AppSettings.USER));
    this.claContributorService.addCompany(userModel.user_id, data).subscribe(
      (response: CompanyModel) => {
        this.companyId = response.companyID;
        this.storageService.removeItem(AppSettings.NEW_ORGANIZATIONS);
        this.getOrganizationInformation(this.companyId);
      },
      (exception) => {
        this.title = 'Request Failed';
        const msg = exception.error.Message ? exception.error.Message : exception.error.message;
        this.message = msg;
        this.openDialog(this.errorModal);
      }
    );
  }

  getOrganizationInformation(companySFID) {
    this.claContributorService.getOrganizationDetails(companySFID).subscribe(
      (response) => {
        this.storageService.setItem(AppSettings.SELECTED_COMPANY, response);
        this.company = response;
        this.manageAuthRedirection();
      },
      (exception) => {
        // To add org in salesforce take couple of seconds
        // So called getOrganizationInformation metod till result comes
        this.failedCount++;
        if (this.failedCount >= AppSettings.MAX_FAILED_COUNT) { // end API call after 20 time failed
          this.title = 'Request Failed';
          this.message = exception.error.Message;
          this.openDialog(this.errorModal);
        } else {
          this.getOrganizationInformation(this.companyId);
        }
      }
    );
  }

  validateUserLFID() {
    if (this.claContributorService.getUserLFID()) {
      if (this.authService.loggedIn) {
        this.addContributorAsDesignee();
      } else {
        this.redirectToAuth0();
      }
    } else {
      // Handle usecase wheather LFID is not present but session already exist in browser.
      if (this.authService.loggedIn) {
        this.addContributorAsDesignee();
      } else {
        this.message = '<p>You will need to create an SSO account with the Linux Foundation to proceed.</p>' +
          '<p>On successful creation of your account, you will be redirected to sign in with your SSO account' +
          ' into the organization dashboard where you can sign the CLAs and approve contributors on behalf of your organization.</p>';
        this.openDialog(this.warningModal);
      }
    }
  }

  addContributorAsDesignee() {
    const authData = JSON.parse(this.storageService.getItem(AppSettings.AUTH_DATA));
    const data = {
      userEmail: authData.user_email
    };
    this.addAsCLAManagerDesignee(data);
  }

  addAsCLAManagerDesignee(data: any) {
    const projectId = JSON.parse(this.storageService.getItem(AppSettings.PROJECT_ID));
    this.claContributorService.addAsCLAManagerDesignee(this.company.companyExternalID, projectId, data).subscribe(
      () => {
        this.hasCLAManagerDesignee = true;
        this.proceedToCorporateConsole();
      },
      (exception) => {
        if (exception.status === 409) {
          // User has already CLA manager designee.
          this.hasCLAManagerDesignee = true;
          this.proceedToCorporateConsole();
        } if (exception.status === 401) {
          this.authService.login();
        } else {
          this.title = 'Request Failed';
          this.storageService.removeItem(AppSettings.ACTION_TYPE);
          this.message = exception.error.Message;
          this.openDialog(this.errorModal);
        }
      }
    );
  }

  proceedToCorporateConsole() {
    if (this.hasCLAManagerDesignee) {
      this.storageService.removeItem(AppSettings.ACTION_TYPE);
      this.showCloseBtnEmitter.emit(true);
    }
  }

  onClickProceedBtn() {
    this.modalService.dismissAll();
    this.message = '<p>You will be redirected to the organization dashboard where you can sign the CLAs and approve contributors on behalf of your organization.</p>';
    this.message += '<p>Note: To continue please disable pop-up blocker for this site.</p>';
    this.openDialog(this.warningModal);
  }

  onClickProceedModalBtn() {
    if (!this.hasCLAManagerDesignee) {
      this.redirectToAuth0();
    } else {
      this.modalService.dismissAll();
      this.loaderService.show();
      const hasGerrit = JSON.parse(this.storageService.getItem(AppSettings.HAS_GERRIT));
      const flashMsg = 'Your ' + (hasGerrit ? 'Gerrit' : 'GitHub') + ' session has been preserved in the current tab so that you can always come back to it after completing CLA signing';
      this.alertService.success(flashMsg);

      const corporateUrl = this.claContributorService.getLFXCorporateURL();
      if (corporateUrl !== '') {
        setTimeout(() => {
          this.storageService.removeItem(AppSettings.ACTION_TYPE);
          window.open(corporateUrl, '_blank');
        }, 4500);

        setTimeout(() => {
          const redirectUrl = JSON.parse(this.storageService.getItem(AppSettings.REDIRECT));
          if (redirectUrl) {
            window.open(redirectUrl, '_self');
          } else {
            this.loaderService.hide();
            this.alertService.error('Error occurred while redirection please confirm you come to the contributor console by following proper steps.');
          }
        }, 4000);
      } else {
        this.loaderService.hide();
      }
    }
  }

  redirectToAuth0() {
    this.storageService.setItem(AppSettings.ACTION_TYPE, AppSettings.SIGN_CLA);
    this.authService.login();
  }

  onClickBackBtn() {
    const data = {
      action: 'CLA_NOT_SIGN',
      payload: false
    }
    this.claContributorService.openDialogModalEvent.next(data);
  }

  onClickClose() {
    this.modalService.dismissAll();
  }

  openDialog(content) {
    this.modalService.open(content, {
      centered: true,
      backdrop: 'static',
      keyboard: false
    });
  }
}
